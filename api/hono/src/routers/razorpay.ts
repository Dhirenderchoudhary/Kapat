import { sValidator } from "@hono/standard-validator"
import { db, razorpayConnections, transactions } from "@packages/db"
import { desc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import { credentialEncryptionAvailable, encryptSecret, maskKeyId } from "@/lib/crypto"
import { ApiError, validationErrorResponses } from "@/lib/error"
import { verifyCredentials } from "@/lib/razorpay-client"
import { SESSION_DAYS, sessionExpiry } from "@/lib/razorpay-session"
import { runSync, startBackfill } from "@/lib/razorpay-sync"

// The live ingestion path: a merchant connects their own Razorpay account once, and the agent pulls
// their payments and runs detection without anyone exporting a CSV.
//
// Scope discipline (Rules.md Principle 1, extended to the integration boundary): this router only
// ever performs GET /v1/payments against Razorpay. There is no code path here that can capture,
// refund, or reverse a payment, and the credential is never returned to any client once stored.

const connectBodySchema = z.object({
  keyId: z
    .string()
    .trim()
    .min(8)
    .max(120)
    .regex(
      /^rzp_(test|live)_[A-Za-z0-9]+$/,
      "Expected a Razorpay key id like rzp_test_XXXXXXXXXXXX",
    ),
  keySecret: z.string().trim().min(8).max(200),
})

const connectionStatusSchema = z.object({
  connected: z.boolean(),
  mode: z.enum(["test", "live"]).nullable(),
  keyId: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastSyncStatus: z.string().nullable(),
  // The 30-day session. `expired` is computed rather than stored so it can never be stale, and
  // `daysRemaining` is what the dashboard warns on before the merchant is locked out mid-week.
  expiresAt: z.string().nullable(),
  daysRemaining: z.number().nullable(),
  expired: z.boolean(),
  autoSyncEnabled: z.boolean(),
  lastAutoSyncAt: z.string().nullable(),
  // First-connect history scan. A merchant needs to know the difference between "no rings found"
  // and "still looking".
  backfill: z.object({
    started: z.boolean(),
    complete: z.boolean(),
    status: z.string().nullable(),
    transactionsIngested: z.number(),
  }),
})

const syncResponseSchema = z.object({
  paymentsFetched: z.number(),
  rowsMapped: z.number(),
  accountsCreated: z.number(),
  transactionsCreated: z.number(),
  clustersDetected: z.number(),
  clustersFlagged: z.number(),
  clustersNewlyPersisted: z.number(),
  signalCoverage: z.record(z.string(), z.number()),
  windowFrom: z.string().nullable(),
})

const DAY_MS = 24 * 60 * 60 * 1000

function projectStatus(conn: typeof razorpayConnections.$inferSelect | null) {
  const now = Date.now()
  const expiresAt = conn?.expiresAt ?? null
  const expired = Boolean(expiresAt && expiresAt.getTime() <= now)
  return {
    connected: Boolean(conn) && !expired,
    mode: (conn?.mode as "test" | "live" | undefined) ?? null,
    keyId: conn ? maskKeyId(conn.keyId) : null,
    lastSyncedAt: conn?.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null,
    lastSyncStatus: conn?.lastSyncStatus ?? null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    daysRemaining: expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - now) / DAY_MS)) : null,
    expired,
    autoSyncEnabled: conn?.autoSyncEnabled ?? false,
    lastAutoSyncAt: conn?.lastAutoSyncAt ? conn.lastAutoSyncAt.toISOString() : null,
    backfill: {
      started: Boolean(conn?.backfillStartedAt),
      complete: Boolean(conn?.backfillCompletedAt),
      status: conn?.backfillStatus ?? null,
      transactionsIngested: conn?.backfillPaymentsIngested ?? 0,
    },
  }
}

async function currentConnection() {
  const [row] = await db
    .select()
    .from(razorpayConnections)
    .orderBy(desc(razorpayConnections.createdAt))
    .limit(1)
  return row ?? null
}

export const razorpayRouter = new Hono()
  .get(
    "/status",
    describeRoute({
      tags: ["Razorpay"],
      description:
        "Whether a Razorpay account is connected, which mode it is in, when it last synced, and whether any transactions have been ingested. Uses a bounded existence check, not dashboard analytics. Never returns the API secret - only a masked key id.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ data: connectionStatusSchema.extend({ hasData: z.boolean() }) }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const [connection, transactionRows] = await Promise.all([
        currentConnection(),
        db.select({ id: transactions.id }).from(transactions).limit(1),
      ])
      return c.json({ data: { ...projectStatus(connection), hasData: transactionRows.length > 0 } })
    },
  )
  .post(
    "/connect",
    describeRoute({
      tags: ["Razorpay"],
      description:
        "Stores a merchant's own Razorpay API credentials after verifying them against Razorpay with a single read-only call. The secret is encrypted at rest (AES-256-GCM) and is never returned by any endpoint. Requires RAZORPAY_CREDENTIAL_KEY to be set - without it this refuses to store anything rather than falling back to plaintext.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: connectionStatusSchema })) },
          },
        },
        ...validationErrorResponses,
      },
    }),
    sValidator("json", connectBodySchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid Razorpay credentials payload", {
          issues: result.error,
        })
      }
    }),
    async (c) => {
      const { keyId, keySecret } = c.req.valid("json")

      if (!credentialEncryptionAvailable()) {
        throw new ApiError(
          503,
          "ENCRYPTION_UNAVAILABLE",
          "RAZORPAY_CREDENTIAL_KEY is not set on the server, so a Razorpay API secret cannot be stored securely. Set it (openssl rand -base64 32) and restart the API. Storing the secret unencrypted is not offered as a fallback.",
        )
      }

      // Verify before storing: a credential that doesn't work should never reach the database, and
      // the merchant should find out immediately rather than at the first failed sync.
      const check = await verifyCredentials(keyId, keySecret)
      if (!check.ok) {
        throw new ApiError(400, "RAZORPAY_AUTH_FAILED", check.message)
      }

      const mode = keyId.startsWith("rzp_live_") ? "live" : "test"

      // One connection at a time in this build: replace rather than accumulate, so there is never
      // ambiguity about which credential a sync used.
      await db.delete(razorpayConnections)
      const [row] = await db
        .insert(razorpayConnections)
        .values({
          mode,
          keyId,
          keySecretEncrypted: encryptSecret(keySecret),
          // Connecting starts a 30-day session, not an open-ended grant. See razorpay-session.ts
          // for why the expiry is a feature.
          expiresAt: sessionExpiry(),
          autoSyncEnabled: true,
        })
        .returning()

      // Scan the merchant's existing payment history immediately, in the background. This is the
      // difference between a dashboard that starts empty and one that shows the rings already in
      // their book on the day they connect. It is detached on purpose: a long history would
      // otherwise hold this request open for minutes.
      await startBackfill(row!, new URL(c.req.url).origin)

      return c.json({ data: projectStatus(row!) })
    },
  )
  .post(
    "/sync",
    describeRoute({
      tags: ["Razorpay"],
      description:
        "The agent run: pulls payments from the connected Razorpay account, maps them onto detector inputs, ingests them idempotently, then runs ring detection and persists what it flagged. Incremental - after a successful sync it only asks Razorpay for payments created since the last one. Safe to re-run; already-ingested payments are skipped at the database level.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: syncResponseSchema })) },
          },
        },
      },
    }),
    async (c) => {
      const conn = await currentConnection()
      if (!conn) {
        throw new ApiError(
          400,
          "NOT_CONNECTED",
          "No Razorpay account is connected. Connect one first.",
        )
      }
      if (conn.expiresAt && conn.expiresAt.getTime() <= Date.now()) {
        throw new ApiError(
          400,
          "SESSION_EXPIRED",
          `This Razorpay connection expired after ${SESSION_DAYS} days. Reconnect the account to resume automatic detection.`,
        )
      }

      // Same function the background poller and the first-connect backfill call, so a hand-pressed
      // sync can never behave differently from an automatic one.
      const summary = await runSync(conn, new URL(c.req.url).origin, {
        full: c.req.query("full") === "1",
      })
      return c.json({ data: summary })
    },
  )
  .post(
    "/auto-sync",
    describeRoute({
      tags: ["Razorpay"],
      description:
        "Pause or resume automatic background detection without disconnecting. Pausing keeps the stored credential and the session clock running; it only stops the poller.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: connectionStatusSchema })) },
          },
        },
      },
    }),
    sValidator("json", z.object({ enabled: z.boolean() }), (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Expected { enabled: boolean }", {
          issues: result.error,
        })
      }
    }),
    async (c) => {
      const conn = await currentConnection()
      if (!conn) {
        throw new ApiError(400, "NOT_CONNECTED", "No Razorpay account is connected.")
      }
      const { enabled } = c.req.valid("json")
      const [row] = await db
        .update(razorpayConnections)
        .set({ autoSyncEnabled: enabled })
        .where(eq(razorpayConnections.id, conn.id))
        .returning()
      return c.json({ data: projectStatus(row!) })
    },
  )
  .delete(
    "/connection",
    describeRoute({
      tags: ["Razorpay"],
      description:
        "Disconnects the Razorpay account and deletes the stored credential. Ingested transaction data is left untouched.",
      responses: { 200: { description: "OK" } },
    }),
    async (c) => {
      await db.delete(razorpayConnections)
      return c.json({ data: { connected: false } })
    },
  )
