import {
  accountLinks,
  accounts,
  auditLog,
  clusterMembers,
  clusters,
  db,
  merchantDecisions,
  transactions,
} from "@packages/db"
import { count, countDistinct, sql, sum } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

// GET /api/analytics - everything the dashboard's analysis view plots, computed in Postgres in one
// round of queries rather than by pulling rows into the API and reducing them in JS.
//
// Every figure here is a live COUNT over real rows. Nothing is sampled, estimated, or carried over
// from a previous run: if the number is on screen, a query produced it just now (Rules.md
// Principle 5). Where a percentage would be misleading on a tiny denominator, the raw counts travel
// alongside it so the UI can show "2 of 3" rather than a confident-looking 66.7%.

const bucketSchema = z.object({
  label: z.string(),
  from: z.number(),
  to: z.number(),
  count: z.number(),
})

const analyticsSchema = z.object({
  totals: z.object({
    accounts: z.number(),
    transactions: z.number(),
    transactionVolumePaise: z.number(),
    accountsInFlaggedRings: z.number(),
    clustersFlagged: z.number(),
    decisionsMade: z.number(),
    auditEntries: z.number(),
  }),
  flaggedShare: z.object({
    accountsFlagged: z.number(),
    accountsClean: z.number(),
    transactionsInFlaggedRings: z.number(),
    transactionsClean: z.number(),
    exposurePaise: z.number(),
  }),
  riskDistribution: z.array(bucketSchema),
  signalBreakdown: z.array(
    z.object({ signalType: z.string(), signalClass: z.string(), edges: z.number() }),
  ),
  clusterSizes: z.array(z.object({ size: z.number(), clusters: z.number() })),
  statusBreakdown: z.record(z.string(), z.number()),
  decisionBreakdown: z.record(z.string(), z.number()),
})

// Mirrors cluster_scorer.py's classification. Duplicated deliberately and narrowly: this endpoint
// only groups edges for a chart, and re-deriving it from the detector would mean a network hop per
// request. tests/test_signal_taxonomy_parity.py is what stops the two drifting.
const SIGNAL_CLASS: Record<string, string> = {
  shared_address: "benign_explainable",
  shared_payment: "benign_explainable",
  coordinated_timing: "weak_fraud_specific",
  shared_promo: "strong_fraud_specific",
  shared_phone_pattern: "strong_fraud_specific",
}

const RISK_BUCKETS = [
  { label: "0.0–0.2", from: 0, to: 0.2 },
  { label: "0.2–0.3", from: 0.2, to: 0.3 },
  { label: "0.3–0.4", from: 0.3, to: 0.4 },
  { label: "0.4–0.5", from: 0.4, to: 0.5 },
  { label: "0.5–0.6", from: 0.5, to: 0.6 },
  { label: "0.6–0.7", from: 0.6, to: 0.7 },
  { label: "0.7–0.8", from: 0.7, to: 0.8 },
  { label: "0.8–1.0", from: 0.8, to: 1.0001 },
]

export const analyticsRouter = new Hono().get(
  "/",
  describeRoute({
    tags: ["Metrics"],
    description:
      "Live analysis of everything ingested: totals, what share of accounts and transactions sit inside a flagged ring, the risk-score distribution, which signals are actually firing, cluster sizes, and the decision funnel. All computed from Postgres on request - nothing cached or estimated.",
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: resolver(z.object({ data: analyticsSchema })) } },
      },
    },
  }),
  async (c) => {
    const [
      [accountRow],
      [txnRow],
      [volumeRow],
      [clusterRow],
      statusRows,
      decisionRows,
      [auditRow],
      clusterScoreRows,
      signalRows,
      memberRows,
      [flaggedAccountsRow],
      [exposureRow],
    ] = await Promise.all([
      db.select({ n: count() }).from(accounts),
      db.select({ n: count() }).from(transactions),
      db.select({ total: sum(transactions.amountPaise) }).from(transactions),
      db.select({ n: count() }).from(clusters),
      db.select({ status: clusters.status, n: count() }).from(clusters).groupBy(clusters.status),
      db
        .select({ action: merchantDecisions.action, n: count() })
        .from(merchantDecisions)
        .groupBy(merchantDecisions.action),
      db.select({ n: count() }).from(auditLog),
      db.select({ riskScore: clusters.riskScore }).from(clusters),
      db
        .select({ signalType: accountLinks.signalType, n: count() })
        .from(accountLinks)
        .groupBy(accountLinks.signalType),
      db.select({ clusterId: clusterMembers.clusterId }).from(clusterMembers),
      db.select({ n: countDistinct(clusterMembers.accountId) }).from(clusterMembers),
      db.select({ total: sum(clusters.chargebackExposurePaise) }).from(clusters),
    ])

    const totalAccounts = accountRow?.n ?? 0
    const totalTransactions = txnRow?.n ?? 0
    const accountsFlagged = flaggedAccountsRow?.n ?? 0

    // Transactions belonging to accounts that sit inside a flagged ring. A subquery rather than
    // pulling ids into JS, because on a real merchant's volume that list is large.
    const [txnInRingsRow] = await db
      .select({ n: count() })
      .from(transactions)
      .where(
        sql`${transactions.accountId} in (select ${clusterMembers.accountId} from ${clusterMembers})`,
      )
    const transactionsInFlaggedRings = txnInRingsRow?.n ?? 0

    const riskDistribution = RISK_BUCKETS.map((b) => ({
      ...b,
      count: clusterScoreRows.filter((r) => r.riskScore >= b.from && r.riskScore < b.to).length,
    }))

    const signalBreakdown = signalRows
      .map((r) => ({
        signalType: r.signalType,
        signalClass: SIGNAL_CLASS[r.signalType] ?? "benign_explainable",
        edges: r.n,
      }))
      .sort((a, b) => b.edges - a.edges)

    const sizeByCluster = new Map<string, number>()
    for (const row of memberRows)
      sizeByCluster.set(row.clusterId, (sizeByCluster.get(row.clusterId) ?? 0) + 1)
    const sizeCounts = new Map<number, number>()
    for (const size of sizeByCluster.values()) sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1)
    const clusterSizes = Array.from(sizeCounts.entries())
      .map(([size, clusters]) => ({ size, clusters }))
      .sort((a, b) => a.size - b.size)

    const statusBreakdown: Record<string, number> = {}
    for (const row of statusRows) statusBreakdown[row.status] = row.n
    const decisionBreakdown: Record<string, number> = {}
    for (const row of decisionRows) decisionBreakdown[row.action] = row.n

    return c.json({
      data: {
        totals: {
          accounts: totalAccounts,
          transactions: totalTransactions,
          transactionVolumePaise: Number(volumeRow?.total ?? 0),
          accountsInFlaggedRings: accountsFlagged,
          clustersFlagged: clusterRow?.n ?? 0,
          decisionsMade: decisionRows.reduce((s, r) => s + r.n, 0),
          auditEntries: auditRow?.n ?? 0,
        },
        flaggedShare: {
          accountsFlagged,
          accountsClean: Math.max(0, totalAccounts - accountsFlagged),
          transactionsInFlaggedRings,
          transactionsClean: Math.max(0, totalTransactions - transactionsInFlaggedRings),
          exposurePaise: Number(exposureRow?.total ?? 0),
        },
        riskDistribution,
        signalBreakdown,
        clusterSizes,
        statusBreakdown,
        decisionBreakdown,
      },
    })
  },
)
