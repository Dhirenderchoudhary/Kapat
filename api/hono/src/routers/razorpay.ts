import { sValidator } from "@hono/standard-validator"
import { db, razorpayConnections } from "@packages/db"
import { desc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import {
  credentialEncryptionAvailable,
  decryptSecret,
  encryptSecret,
  maskKeyId,
} from "@/lib/crypto"
import { ApiError, validationErrorResponses } from "@/lib/error"
import {
  fetchAllPayments,
  mapPayment,
  RazorpayError,
  verifyCredentials,
} from "@/lib/razorpay-client"

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
        "Whether a Razorpay account is connected, which mode it is in, and when it last synced. Never returns the API secret - only a masked key id.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: connectionStatusSchema })) },
          },
        },
      },
    }),
    async (c) => {
      const conn = await currentConnection()
      return c.json({
        data: {
          connected: Boolean(conn),
          mode: (conn?.mode as "test" | "live" | undefined) ?? null,
          keyId: conn ? maskKeyId(conn.keyId) : null,
          lastSyncedAt: conn?.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null,
          lastSyncStatus: conn?.lastSyncStatus ?? null,
        },
      })
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
        .values({ mode, keyId, keySecretEncrypted: encryptSecret(keySecret) })
        .returning()

      return c.json({
        data: {
          connected: true,
          mode: row!.mode as "test" | "live",
          keyId: maskKeyId(row!.keyId),
          lastSyncedAt: null,
          lastSyncStatus: null,
        },
      })
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

      let keySecret: string
      try {
        keySecret = decryptSecret(conn.keySecretEncrypted)
      } catch (cause) {
        throw new ApiError(
          503,
          "CREDENTIAL_UNREADABLE",
          `Stored Razorpay credential could not be decrypted (${cause instanceof Error ? cause.message : "unknown error"}). This usually means RAZORPAY_CREDENTIAL_KEY changed since it was saved. Reconnect the account.`,
        )
      }

      // Incremental window. A small overlap on re-sync is harmless because ingestion is idempotent
      // on the Razorpay payment id, and it avoids missing a payment that landed mid-sync.
      const from = conn.lastSyncedAt
        ? new Date(conn.lastSyncedAt.getTime() - 60 * 60 * 1000)
        : undefined
      const startedAt = new Date()

      let payments
      try {
        payments = await fetchAllPayments({ keyId: conn.keyId, keySecret, from })
      } catch (cause) {
        await db
          .update(razorpayConnections)
          .set({
            lastSyncStatus: cause instanceof Error ? cause.message.slice(0, 300) : "sync failed",
          })
          .where(eq(razorpayConnections.id, conn.id))
        if (cause instanceof RazorpayError) {
          throw new ApiError(502, "RAZORPAY_SYNC_FAILED", cause.message)
        }
        throw cause
      }

      const rows = payments.map(mapPayment).filter((r): r is NonNullable<typeof r> => r !== null)

      if (rows.length === 0) {
        await db
          .update(razorpayConnections)
          .set({
            lastSyncedAt: startedAt,
            lastSyncStatus: `synced ${payments.length} payments (0 new mapped rows)`,
          })
          .where(eq(razorpayConnections.id, conn.id))

        return c.json({
          data: {
            paymentsFetched: payments.length,
            rowsMapped: 0,
            accountsCreated: 0,
            transactionsCreated: 0,
            clustersDetected: 0,
            clustersFlagged: 0,
            signalCoverage: {
              deliveryAddress: 0,
              paymentFingerprint: 0,
              phoneNumber: 0,
              promoCode: 0,
            },
          },
        })
      }

      // Reuse the exact ingest + detect path the CSV upload uses - one code path, so a merchant on
      // the live integration and a merchant on a CSV get identical treatment (and identical bugs,
      // which is the point: there is no second, divergent pipeline to keep in sync).
      const origin = new URL(c.req.url).origin
      const ingestRes = await fetch(`${origin}/api/ingest/transactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows, sourceLabel: `razorpay:${conn.mode}` }),
      })
      if (!ingestRes.ok) {
        const errBody = await ingestRes.text().catch(() => "")
        throw new ApiError(
          502,
          "INGEST_FAILED",
          `Ingest step failed with ${ingestRes.status}: ${errBody}`,
        )
      }
      const ingest = (await ingestRes.json()).data as {
        accountsCreated: number
        transactionsCreated: number
        signalCoverage: Record<string, number>
      }

      const detectRes = await fetch(`${origin}/api/clusters/detect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!detectRes.ok) {
        throw new ApiError(502, "DETECT_FAILED", `Detection step failed with ${detectRes.status}`)
      }
      const detect = (await detectRes.json()).data as {
        clustersDetected: number
        clustersFlagged: number
        clustersNewlyPersisted: number
      }

      await db
        .update(razorpayConnections)
        .set({ lastSyncedAt: startedAt, lastSyncStatus: "ok" })
        .where(eq(razorpayConnections.id, conn.id))

      return c.json({
        data: {
          paymentsFetched: payments.length,
          rowsMapped: rows.length,
          accountsCreated: ingest.accountsCreated,
          transactionsCreated: ingest.transactionsCreated,
          clustersDetected: detect.clustersDetected,
          clustersFlagged: detect.clustersFlagged,
          clustersNewlyPersisted: detect.clustersNewlyPersisted,
          signalCoverage: ingest.signalCoverage,
          windowFrom: from ? from.toISOString() : null,
        },
      })
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
