import { createHash } from "node:crypto"

import { sValidator } from "@hono/standard-validator"
import {
  accountLinks,
  accounts,
  auditLog,
  clusterMembers,
  clusters,
  db,
  merchantDecisions,
  transactions,
  verifications,
} from "@packages/db"
import { and, count, desc, eq, inArray, ne } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import { detectRingsPure, type ScoredCluster } from "@/lib/detector"
import {
  ApiError,
  conflictErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { countedTotal, paging, pagingFields } from "@/lib/paging"

// Architecture.md §6: GET /api/clusters, GET /api/clusters/:id. Deliberately no auth middleware
// here - Design.md §4 lists "no merchant auth/login flows" under What NOT To Design for this
// build, so these read the same way `waitlist.ts` does: a plain, unauthenticated router (not the
// authMiddleware/session pattern `v1.ts`/`admin.ts` use for the actual console).

const CLUSTER_STATUSES = ["pending_review", "pending_verification", "resolved"] as const

// verifications.outcome's meaning is inverted from what the words suggest in this ring-
// verification context (Memory.md decision 14, Design.md §3): confirming awareness of the linked
// account leans *legitimate* (family/shared household), denying it *strengthens* the ring
// hypothesis. This maps the raw outcome to the label Design.md §1.1's "Verification status"
// column actually wants a merchant to read - getting this backwards is exactly the "easy place to
// introduce a silent logic bug" both documents warn about, so the mapping lives in exactly one
// place.
const VERIFICATION_STATUS_LABEL: Record<string, string> = {
  confirmed_linked: "verified_legitimate",
  denied_linked: "verified_linked",
  unclear: "unclear",
  no_response: "no_response",
}
const NOT_YET_TRIGGERED = "not_yet_triggered"

// Phase 7 (Phases.md): POST /:id/decision. Only this row may trigger anything downstream
// (Rules.md Principle 1) - the detector's risk_score and the verifier's outcome never freeze or
// block anything by themselves.
const DECISION_ACTIONS = ["freeze", "block", "escalate", "dismiss"] as const

const decisionBodySchema = z
  .object({
    action: z.enum(DECISION_ACTIONS),
    // Required only when action = "dismiss" - checked here for a friendly 400 message, but the
    // actual guarantee is merchant_decisions_dismiss_reason_check at the database level
    // (packages/db/src/schema/fraud.ts), matching Principle 3's "app-level checks are for error
    // messages, not the guarantee" pattern applied to Principle 10 as well.
    reason: z.string().trim().min(1).max(2000).optional(),
    // No merchant auth on these pages (Design.md §4), so the caller supplies who decided.
    decidedBy: z.string().trim().min(1).max(200),
  })
  .refine((val) => val.action !== "dismiss" || Boolean(val.reason && val.reason.length > 0), {
    message: "reason is required when action is dismiss",
    path: ["reason"],
  })

// The status a cluster moves to once this decision executes. freeze/block/dismiss all close the
// open review (Design.md §1.2's four actions); escalate deliberately keeps the cluster in front
// of a human for deeper manual review (PRD.md §7 Flow C) rather than resolving it.
const STATUS_AFTER_DECISION: Record<
  (typeof DECISION_ACTIONS)[number],
  (typeof CLUSTER_STATUSES)[number]
> = {
  freeze: "resolved",
  block: "resolved",
  dismiss: "resolved",
  escalate: "pending_review",
}

const listQuerySchema = z.object({
  status: z.enum(CLUSTER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
})

const clusterListItemSchema = z.object({
  id: z.string(),
  riskScore: z.number().meta({ example: 0.87 }),
  status: z.enum(CLUSTER_STATUSES),
  chargebackExposurePaise: z.number().nullable(),
  accountCount: z.number(),
  verificationStatus: z.string().meta({ example: NOT_YET_TRIGGERED }),
  createdAt: z.string(),
})

const evidenceSchema = z.object({
  id: z.string(),
  accountA: z.string(),
  accountB: z.string(),
  signalType: z.string(),
  confidence: z.number(),
})

const accountSchema = z.object({
  id: z.string(),
  customerRef: z.string(),
  deliveryAddress: z.string().nullable(),
  paymentMethodFingerprint: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  // Design.md §2: node size ∝ transaction volume, node color communicates signal strength. Real
  // per-account transaction_risk.py scores aren't threaded through this API yet (Phase 4 exposes
  // them at the cluster level; wiring a per-account figure through /detect-rings -> Postgres is
  // future work, not invented here) - avgSignalConfidence is a real, already-available substitute:
  // how strongly this account's own edges evidence a shared signal with the rest of the cluster.
  transactionCount: z.number(),
  avgSignalConfidence: z.number(),
})

const verificationSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  languageCode: z.string(),
  transcript: z.string().nullable(),
  outcome: z.string(),
  verificationStatus: z.string(),
  confidence: z.number().nullable(),
})

const decisionSchema = z.object({
  id: z.string(),
  action: z.string(),
  reason: z.string().nullable(),
  decidedBy: z.string(),
  decidedAt: z.string(),
})

const auditEntrySchema = z.object({
  id: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
})

const clusterDetailSchema = clusterListItemSchema.extend({
  accounts: z.array(accountSchema),
  evidence: z.array(evidenceSchema),
  verifications: z.array(verificationSchema),
  decisions: z.array(decisionSchema),
  auditLog: z.array(auditEntrySchema),
})

async function latestVerificationStatusByCluster(
  clusterIds: string[],
): Promise<Map<string, string>> {
  if (clusterIds.length === 0) return new Map()
  // No timestamp column on verifications yet (schema gap, not invented around) - fine while
  // Phase 6 (verifier integration) is unstarted and every cluster has at most a handful of rows;
  // revisit once multiple verification attempts per cluster are a real scenario.
  const rows = await db
    .select({ clusterId: verifications.clusterId, outcome: verifications.outcome })
    .from(verifications)
    .where(inArray(verifications.clusterId, clusterIds))
  const byCluster = new Map<string, string>()
  for (const row of rows) {
    if (!byCluster.has(row.clusterId)) {
      byCluster.set(row.clusterId, VERIFICATION_STATUS_LABEL[row.outcome] ?? "unclear")
    }
  }
  return byCluster
}

// Phase 8's live-agent gap (Memory.md decision 23/24): services/detector-service's real
// build_graph -> find_clusters -> score_cluster pipeline was fully built and tested, but nothing
// in this API ever called its live POST /detect-rings and persisted the result - webhooks.ts
// only ever inserts raw accounts/transactions. POST /detect below is that missing wire: it calls
// the actual running detector-service over HTTP (Architecture.md §6's documented "(internal)
// POST services/detector-service /detect-rings" contract), not a local reimplementation of its
// logic, so what lands in Postgres is genuinely what the agent detected, not a script's
// approximation of it.

const detectBodySchema = z.object({
  minClusterSize: z.number().int().min(2).max(50).default(2),
})

const detectResponseSchema = z.object({
  accountsConsidered: z.number(),
  transactionsConsidered: z.number(),
  clustersDetected: z.number(),
  clustersFlagged: z.number(),
  clustersNewlyPersisted: z.number(),
  accountLinksNewlyPersisted: z.number(),
  // Which brain actually produced these clusters. Never omit it and never default it to the
  // Python service: the two engines do NOT use the same clustering algorithm (see @/lib/detector),
  // and every measured number this project publishes was produced by the Python one. A run that
  // silently fell back is a run none of those numbers describe, so it has to say so out loud.
  engine: z.enum(["detector-service", "typescript-fallback"]),
  clusteringMethod: z.enum(["louvain", "connected_components"]),
  fallbackReason: z.string().nullable(),
})

// Deterministic, content-derived ids (not the schema's crypto.randomUUID() default) for clusters/
// account_links created by detection - re-running POST /detect after new accounts/transactions
// arrive must never create a duplicate row for the same detected grouping/edge. The real
// guarantee is onConflictDoNothing below, matching account_links_pair_signal_uidx /
// clusters' primary key (Rules.md Principle 3: the database constraint is the guarantee, this is
// just how the same content reliably produces the same id to conflict against).
function deterministicId(prefix: string, parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20)
  return `${prefix}_${hash}`
}

export const clustersRouter = new Hono()
  .get(
    "/",
    describeRoute({
      tags: ["Clusters"],
      description: "List flagged clusters, sorted by risk score descending (Design.md §1.1)",
      ...({
        "x-codeSamples": [
          {
            lang: "typescript",
            label: "hono/client",
            source: `import { apiClient, unwrap } from "@/lib/api/client"

const { data, error } = await unwrap(apiClient.clusters.$get())`,
          },
        ],
      } as object),
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  data: z.object({
                    clusters: z.array(clusterListItemSchema),
                    ...pagingFields,
                  }),
                }),
              ),
            },
          },
        },
        ...validationErrorResponses,
      },
    }),
    async (c) => {
      const parsed = listQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid query", { issues: parsed.error })
      }
      const { status, page, perPage } = parsed.data
      const where = status ? eq(clusters.status, status) : undefined
      const query = db.select().from(clusters)
      const countQuery = db.select({ value: count() }).from(clusters)

      const [rows, totalRes] = await Promise.all([
        (where ? query.where(where) : query)
          .orderBy(desc(clusters.riskScore), desc(clusters.createdAt))
          .limit(perPage)
          .offset((page - 1) * perPage),
        where ? countQuery.where(where) : countQuery,
      ])
      const total = totalRes[0]?.value ?? 0

      const clusterIds = rows.map((r) => r.id)
      const [accountCounts, verificationStatuses] = await Promise.all([
        clusterIds.length
          ? db
              .select({ clusterId: clusterMembers.clusterId })
              .from(clusterMembers)
              .where(inArray(clusterMembers.clusterId, clusterIds))
          : Promise.resolve([]),
        latestVerificationStatusByCluster(clusterIds),
      ])
      const countByCluster = new Map<string, number>()
      for (const row of accountCounts) {
        countByCluster.set(row.clusterId, (countByCluster.get(row.clusterId) ?? 0) + 1)
      }

      const data = {
        clusters: rows.map((row) => ({
          id: row.id,
          riskScore: row.riskScore,
          status: row.status as (typeof CLUSTER_STATUSES)[number],
          chargebackExposurePaise: row.chargebackExposurePaise,
          accountCount: countByCluster.get(row.id) ?? 0,
          verificationStatus: verificationStatuses.get(row.id) ?? NOT_YET_TRIGGERED,
          createdAt: (row.createdAt instanceof Date
            ? row.createdAt
            : new Date(row.createdAt)
          ).toISOString(),
        })),
        ...paging({ page, perPage, total }),
      }
      return c.json({ data })
    },
  )
  .post(
    "/detect",
    describeRoute({
      tags: ["Clusters"],
      description:
        "Runs the detector against every account/transaction in Postgres and persists clusters and labeled edges. Prefers services/detector-service (Python Louvain). If that sidecar is unreachable, uses the TypeScript Louvain port. Those paths can still disagree on the densest graphs because node visit order differs; the response always includes `engine` and `clusteringMethod`. Published metrics in data/*.json were measured on the Python path.",
      ...({
        "x-codeSamples": [
          {
            lang: "typescript",
            label: "hono/client",
            source: `import { apiClient, unwrap } from "@/lib/api/client"

const { data, error } = await unwrap(apiClient.clusters.detect.$post({ json: {} }))`,
          },
        ],
      } as object),
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(z.object({ data: detectResponseSchema })),
            },
          },
        },
        ...validationErrorResponses,
      },
    }),
    sValidator("json", detectBodySchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid request", { issues: result.error })
      }
    }),
    async (c) => {
      const { minClusterSize } = c.req.valid("json")

      const [accountRows, transactionRows] = await Promise.all([
        db.select().from(accounts),
        db.select().from(transactions),
      ])

      if (accountRows.length === 0 || transactionRows.length === 0) {
        return c.json({
          data: {
            accountsConsidered: accountRows.length,
            transactionsConsidered: transactionRows.length,
            clustersDetected: 0,
            clustersFlagged: 0,
            clustersNewlyPersisted: 0,
            accountLinksNewlyPersisted: 0,
          },
        })
      }

      // detector-service's contract is snake_case (Architecture.md §6, services/detector-service/
      // main.py) - this is the one place that boundary gets crossed, kept to exactly the fields
      // graph_builder.py / transaction_risk.py actually read (verified against their source).
      const detectorAccounts = accountRows.map((a) => ({
        id: a.id,
        delivery_address: a.deliveryAddress,
        payment_method_fingerprint: a.paymentMethodFingerprint,
        phone_number: a.phoneNumber,
        created_at: a.createdAt.toISOString(),
      }))
      const detectorTransactions = transactionRows.map((t) => ({
        id: t.id,
        account_id: t.accountId,
        amount_paise: t.amountPaise,
        promo_code: t.promoCode,
        created_at: t.createdAt.toISOString(),
      }))

      const detectorServiceUrl = process.env.DETECTOR_SERVICE_URL ?? "http://localhost:8001"
      let resultClusters: ScoredCluster[] = []

      // Which engine ran, tracked rather than assumed. The TypeScript fallback is NOT a port of
      // the Python detector: it groups with connected components where the Python service runs
      // Louvain, so on the same input the two can return different clusters (@/lib/detector says
      // so at length). Every published metric in data/*.json was measured on the Python path, so a
      // fallback run is one no published number describes. It gets recorded on the response, in
      // the audit log, and in the logs - never silently substituted.
      let engine: "detector-service" | "typescript-fallback" = "detector-service"
      let fallbackReason: string | null = null

      const useFallback = (reason: string) => {
        engine = "typescript-fallback"
        fallbackReason = reason
        console.warn(
          `[clusters/detect] detector-service unavailable (${reason}). Falling back to the ` +
            `TypeScript detector, which clusters by connected components rather than Louvain. ` +
            `Results from this run are not comparable to the published metrics in data/.`,
        )
        return detectRingsPure(detectorAccounts, detectorTransactions, minClusterSize)
      }

      try {
        const response = await fetch(`${detectorServiceUrl}/detect-rings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accounts: detectorAccounts,
            transactions: detectorTransactions,
            min_cluster_size: minClusterSize,
          }),
        })
        if (response.ok) {
          const res = (await response.json()) as { clusters: ScoredCluster[] }
          resultClusters = res.clusters
        } else {
          resultClusters = useFallback(`HTTP ${response.status} from ${detectorServiceUrl}`)
        }
      } catch (error) {
        resultClusters = useFallback(
          error instanceof Error ? error.message : "detector-service unreachable",
        )
      }

      const clusteringMethod = engine === "detector-service" ? "louvain" : "connected_components"
      const result = { clusters: resultClusters }

      let clustersNewlyPersisted = 0
      let accountLinksNewlyPersisted = 0

      // Only clusters the detector actually FLAGGED reach the merchant's queue. Communities it
      // computed but scored below its threshold are real output, but they are the ones with an
      // ordinary innocent explanation - surfacing them is precisely the 41.7%-precision behaviour
      // the Phase 10 redesign removed (Memory.md decision 25). They are counted in the response so
      // the run stays auditable, just not persisted as flagged rings.
      const flaggedClusters = result.clusters.filter((c) => c.score.flagged)

      await db.transaction(async (tx) => {
        for (const detected of flaggedClusters) {
          const members = [...detected.member_account_ids].sort()
          const clusterId = deterministicId("cl_live", members)

          const [insertedCluster] = await tx
            .insert(clusters)
            .values({
              id: clusterId,
              riskScore: detected.score.risk_score,
              chargebackExposurePaise: detected.score.chargeback_exposure_paise ?? null,
            })
            .onConflictDoNothing({ target: clusters.id })
            .returning({ id: clusters.id })

          if (insertedCluster) {
            clustersNewlyPersisted += 1
            await tx
              .insert(clusterMembers)
              .values(members.map((accountId) => ({ clusterId, accountId })))
              .onConflictDoNothing()

            // Rules.md Principle 2: the detection itself is part of the cluster's audit chain, not
            // just the merchant's later decision. Storing the detector's own explanation verbatim
            // means the dashboard renders the agent's actual reasoning rather than the dashboard's
            // paraphrase of it, and a reviewer can see why this group was flagged months later.
            await tx.insert(auditLog).values({
              clusterId,
              payload: {
                event: "cluster_detected",
                detectedBy:
                  engine === "detector-service"
                    ? "detector-service /detect-rings"
                    : "api/hono TypeScript fallback detector (detector-service unreachable)",
                engine,
                clusteringMethod,
                fallbackReason,
                riskScore: detected.score.risk_score,
                rawRiskScore: detected.score.raw_risk_score,
                flagThreshold: detected.score.flag_threshold,
                ceilingApplied: detected.score.ceiling_applied,
                explanation: detected.score.explanation,
                features: detected.score.features,
                memberAccountIds: members,
                note: "Detection only. Rules.md Principle 1: this flags a cluster for a human to review - it does not freeze, block or act on anything by itself.",
              },
            })
          }

          for (const evidence of detected.score.evidence) {
            const [accountA, accountB] = [...evidence.accounts_involved].sort() as [string, string]
            const linkId = deterministicId("link", [accountA, accountB, evidence.signal_type])
            const [insertedLink] = await tx
              .insert(accountLinks)
              .values({
                id: linkId,
                accountA,
                accountB,
                signalType: evidence.signal_type,
                confidence: evidence.confidence,
              })
              .onConflictDoNothing({
                target: [accountLinks.accountA, accountLinks.accountB, accountLinks.signalType],
              })
              .returning({ id: accountLinks.id })
            if (insertedLink) accountLinksNewlyPersisted += 1
          }
        }
      })

      return c.json({
        data: {
          accountsConsidered: accountRows.length,
          transactionsConsidered: transactionRows.length,
          clustersDetected: result.clusters.length,
          clustersFlagged: flaggedClusters.length,
          clustersNewlyPersisted,
          accountLinksNewlyPersisted,
          engine,
          clusteringMethod,
          fallbackReason,
        },
      })
    },
  )
  .get(
    "/:id",
    describeRoute({
      tags: ["Clusters"],
      description:
        "Full cluster detail - members, evidence, verifications, decisions, audit log in one call (Rules.md Principle 2)",
      ...({
        "x-codeSamples": [
          {
            lang: "typescript",
            label: "hono/client",
            source: `import { apiClient, unwrap } from "@/lib/api/client"

const { data, error } = await unwrap(apiClient.clusters[":id"].$get({ param: { id } }))`,
          },
        ],
      } as object),
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(z.object({ data: clusterDetailSchema })),
            },
          },
        },
        ...notFoundErrorResponses,
      },
    }),
    async (c) => {
      const id = c.req.param("id")

      const [cluster] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1)
      if (!cluster) {
        throw new ApiError(404, "NOT_FOUND", "Cluster not found")
      }

      const memberRows = await db
        .select({ accountId: clusterMembers.accountId })
        .from(clusterMembers)
        .where(eq(clusterMembers.clusterId, id))
      const memberIds = memberRows.map((r) => r.accountId)

      const [memberAccounts, links, verificationRows, decisionRows, auditRows, txnCounts] =
        await Promise.all([
          memberIds.length
            ? db.select().from(accounts).where(inArray(accounts.id, memberIds))
            : Promise.resolve([]),
          // Evidence is every account_links row strictly between two members of this cluster - the
          // same graph edges graph_builder.py produced, never an unlabeled connection (Principle 9).
          memberIds.length
            ? db
                .select()
                .from(accountLinks)
                .where(
                  and(
                    inArray(accountLinks.accountA, memberIds),
                    inArray(accountLinks.accountB, memberIds),
                  ),
                )
            : Promise.resolve([]),
          db.select().from(verifications).where(eq(verifications.clusterId, id)),
          db
            .select()
            .from(merchantDecisions)
            .where(eq(merchantDecisions.clusterId, id))
            .orderBy(desc(merchantDecisions.decidedAt)),
          db
            .select()
            .from(auditLog)
            .where(eq(auditLog.clusterId, id))
            .orderBy(desc(auditLog.createdAt)),
          memberIds.length
            ? db
                .select({ accountId: transactions.accountId, transactionCount: count() })
                .from(transactions)
                .where(inArray(transactions.accountId, memberIds))
                .groupBy(transactions.accountId)
            : Promise.resolve([]),
        ])

      const txnCountByAccount = new Map(txnCounts.map((r) => [r.accountId, r.transactionCount]))
      const confidenceSumByAccount = new Map<string, { sum: number; n: number }>()
      for (const link of links) {
        for (const accountId of [link.accountA, link.accountB]) {
          const entry = confidenceSumByAccount.get(accountId) ?? { sum: 0, n: 0 }
          entry.sum += link.confidence
          entry.n += 1
          confidenceSumByAccount.set(accountId, entry)
        }
      }

      const data = {
        id: cluster.id,
        riskScore: cluster.riskScore,
        status: cluster.status as (typeof CLUSTER_STATUSES)[number],
        chargebackExposurePaise: cluster.chargebackExposurePaise,
        accountCount: memberIds.length,
        verificationStatus:
          verificationRows.length > 0
            ? (VERIFICATION_STATUS_LABEL[verificationRows[0]!.outcome] ?? "unclear")
            : NOT_YET_TRIGGERED,
        createdAt: cluster.createdAt.toISOString(),
        accounts: memberAccounts.map((a) => {
          const conf = confidenceSumByAccount.get(a.id)
          return {
            id: a.id,
            customerRef: a.customerRef,
            deliveryAddress: a.deliveryAddress,
            paymentMethodFingerprint: a.paymentMethodFingerprint,
            phoneNumber: a.phoneNumber,
            transactionCount: txnCountByAccount.get(a.id) ?? 0,
            avgSignalConfidence: conf ? conf.sum / conf.n : 0,
          }
        }),
        evidence: links.map((l) => ({
          id: l.id,
          accountA: l.accountA,
          accountB: l.accountB,
          signalType: l.signalType,
          confidence: l.confidence,
        })),
        verifications: verificationRows.map((v) => ({
          id: v.id,
          accountId: v.accountId,
          languageCode: v.languageCode,
          transcript: v.transcript,
          outcome: v.outcome,
          verificationStatus: VERIFICATION_STATUS_LABEL[v.outcome] ?? "unclear",
          confidence: v.confidence,
        })),
        decisions: decisionRows.map((d) => ({
          id: d.id,
          action: d.action,
          reason: d.reason,
          decidedBy: d.decidedBy,
          decidedAt: d.decidedAt.toISOString(),
        })),
        auditLog: auditRows.map((a) => ({
          id: a.id,
          payload: a.payload,
          createdAt: a.createdAt.toISOString(),
        })),
      }
      return c.json({ data })
    },
  )
  .post(
    "/:id/decision",
    describeRoute({
      tags: ["Clusters"],
      description:
        "Merchant decision on a flagged cluster - freeze/block/escalate/dismiss (Rules.md Principle 1: only this row may trigger the executor). Idempotent: a cluster that already has a final decision returns 409 rather than executing a second time (Rules.md Principle 3's database-level-guarantee spirit, extended past the webhook case it names).",
      ...({
        "x-codeSamples": [
          {
            lang: "typescript",
            label: "hono/client",
            source: `import { apiClient, unwrap } from "@/lib/api/client"

const { data, error } = await unwrap(
  apiClient.clusters[":id"].decision.$post({
    param: { id },
    json: { action: "dismiss", reason: "legitimate shared household", decidedBy: "merchant" },
  }),
)`,
          },
        ],
      } as object),
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  data: z.object({ decision: decisionSchema, status: z.enum(CLUSTER_STATUSES) }),
                }),
              ),
            },
          },
        },
        ...validationErrorResponses,
        ...notFoundErrorResponses,
        ...conflictErrorResponses,
      },
    }),
    sValidator("json", decisionBodySchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid decision", { issues: result.error })
      }
    }),
    async (c) => {
      const id = c.req.param("id")
      const { action, reason, decidedBy } = c.req.valid("json")

      const [cluster] = await db
        .select({ id: clusters.id })
        .from(clusters)
        .where(eq(clusters.id, id))
        .limit(1)
      if (!cluster) {
        throw new ApiError(404, "NOT_FOUND", "Cluster not found")
      }

      const result = await db.transaction(async (tx) => {
        // Rules.md Principle 1: only inserting this row may trigger anything downstream - it
        // happens before any status change or audit write, never the other way round.
        const [decision] = await tx
          .insert(merchantDecisions)
          .values({ clusterId: id, action, reason: reason ?? null, decidedBy })
          .returning()

        // Database-level idempotency guard: the compare-and-set lives in the WHERE clause (not
        // an app-level check beforehand), so a concurrent double-click - or a retried request -
        // can't slip a second execution past a stale read. A cluster that's already resolved
        // cannot be decided again.
        const [updated] = await tx
          .update(clusters)
          .set({ status: STATUS_AFTER_DECISION[action] })
          .where(and(eq(clusters.id, id), ne(clusters.status, "resolved")))
          .returning({ status: clusters.status })

        if (!updated) {
          throw new ApiError(
            409,
            "CONFLICT",
            "This cluster already has a final decision and cannot be decided again.",
          )
        }

        const memberRows = await tx
          .select({ accountId: clusterMembers.accountId })
          .from(clusterMembers)
          .where(eq(clusterMembers.clusterId, id))

        // One structured audit record of what the executor did (Rules.md Principle 2). This IS
        // the executor for a synthetic-data sandbox (Rules.md Principle 6): there's no real
        // Razorpay account to actually freeze, so "executing" means recording the effect
        // honestly rather than silently implying a live payment processor was contacted.
        await tx.insert(auditLog).values({
          clusterId: id,
          payload: {
            event: "decision_executed",
            decisionId: decision!.id,
            action,
            reason: reason ?? null,
            decidedBy,
            affectedAccountIds: memberRows.map((r) => r.accountId),
            clusterStatusAfter: updated.status,
            note: "Synthetic sandbox executor (Rules.md Principle 6) - no real Razorpay API is called; this records what the decision would trigger downstream.",
          },
        })

        return { decision: decision!, status: updated.status }
      })

      return c.json({
        data: {
          decision: {
            id: result.decision.id,
            action: result.decision.action,
            reason: result.decision.reason,
            decidedBy: result.decision.decidedBy,
            decidedAt: result.decision.decidedAt.toISOString(),
          },
          status: result.status as (typeof CLUSTER_STATUSES)[number],
        },
      })
    },
  )
