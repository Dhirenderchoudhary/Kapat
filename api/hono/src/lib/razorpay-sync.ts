import { db, razorpayConnections } from "@packages/db"
import { eq } from "drizzle-orm"

import { decryptSecret } from "@/lib/crypto"
import { ApiError } from "@/lib/error"
import { fetchAllPayments, mapPayment, RazorpayError } from "@/lib/razorpay-client"

/**
 * One sync: pull payments from a connected Razorpay account, ingest them, run detection.
 *
 * WHY THIS LIVES IN A LIB AND NOT IN THE ROUTER
 * =============================================
 * Three different things need to run exactly this sequence, and they must not drift apart:
 *
 *   1. POST /api/razorpay/sync        the merchant pressing the button by hand
 *   2. POST /api/razorpay/connect     the first-connect backfill over their whole history
 *   3. the background poller          every few minutes, so the merchant never presses anything
 *
 * If any of those grew its own copy, one of them would eventually ingest without detecting, or
 * detect without updating lastSyncedAt, and the bug would only show up as "the dashboard is stale"
 * weeks later. One function, three callers.
 *
 * It also reuses the same HTTP ingest + detect endpoints the CSV upload uses rather than calling
 * into the database directly, deliberately: a merchant on the live Razorpay integration and a
 * merchant on a CSV get identical treatment, and identical bugs, because there is only one path.
 */

export type SyncSummary = {
  paymentsFetched: number
  rowsMapped: number
  accountsCreated: number
  transactionsCreated: number
  clustersDetected: number
  clustersFlagged: number
  clustersNewlyPersisted: number
  signalCoverage: Record<string, number>
  windowFrom: string | null
  full: boolean
}

type Connection = typeof razorpayConnections.$inferSelect

/** Overlap on an incremental re-sync. Ingestion is idempotent on the Razorpay payment id, so
 *  re-reading an hour costs nothing and closes the window where a payment lands mid-sync. */
const INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000

export function decryptOrThrow(conn: Connection): string {
  try {
    return decryptSecret(conn.keySecretEncrypted)
  } catch (cause) {
    throw new ApiError(
      503,
      "CREDENTIAL_UNREADABLE",
      `Stored Razorpay credential could not be decrypted (${
        cause instanceof Error ? cause.message : "unknown error"
      }). This usually means RAZORPAY_CREDENTIAL_KEY changed since it was saved. Reconnect the account.`,
    )
  }
}

export async function runSync(
  conn: Connection,
  origin: string,
  opts: { full?: boolean } = {},
): Promise<SyncSummary> {
  const full = opts.full ?? false
  const keySecret = decryptOrThrow(conn)

  // A full run asks Razorpay for everything it has. That is what makes PAST fraud visible on the
  // day a merchant connects, instead of the dashboard starting empty and only filling as new
  // payments arrive - which is the difference between a product and a demo.
  const from =
    full || !conn.lastSyncedAt
      ? undefined
      : new Date(conn.lastSyncedAt.getTime() - INCREMENTAL_OVERLAP_MS)
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

  const empty: SyncSummary = {
    paymentsFetched: payments.length,
    rowsMapped: 0,
    accountsCreated: 0,
    transactionsCreated: 0,
    clustersDetected: 0,
    clustersFlagged: 0,
    clustersNewlyPersisted: 0,
    signalCoverage: { deliveryAddress: 0, paymentFingerprint: 0, phoneNumber: 0, promoCode: 0 },
    windowFrom: from ? from.toISOString() : null,
    full,
  }

  if (rows.length === 0) {
    await db
      .update(razorpayConnections)
      .set({
        lastSyncedAt: startedAt,
        lastSyncStatus: `synced ${payments.length} payments (0 new mapped rows)`,
      })
      .where(eq(razorpayConnections.id, conn.id))
    return empty
  }

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

  return {
    paymentsFetched: payments.length,
    rowsMapped: rows.length,
    accountsCreated: ingest.accountsCreated,
    transactionsCreated: ingest.transactionsCreated,
    clustersDetected: detect.clustersDetected,
    clustersFlagged: detect.clustersFlagged,
    clustersNewlyPersisted: detect.clustersNewlyPersisted,
    signalCoverage: ingest.signalCoverage,
    windowFrom: from ? from.toISOString() : null,
    full,
  }
}

/**
 * The first-connect backfill: every payment the merchant already has, scored.
 *
 * Runs detached from the connect request on purpose. A merchant with two years of history would
 * otherwise stare at a spinner for minutes and probably reload, and a reload mid-backfill is how
 * you get two of them racing. The connect response returns immediately, the row records progress,
 * and GET /status reports it, so the dashboard can show "scanning your history" honestly instead
 * of pretending to be finished.
 */
export async function startBackfill(conn: Connection, origin: string): Promise<void> {
  await db
    .update(razorpayConnections)
    .set({ backfillStartedAt: new Date(), backfillStatus: "running" })
    .where(eq(razorpayConnections.id, conn.id))

  void (async () => {
    try {
      const summary = await runSync(conn, origin, { full: true })
      await db
        .update(razorpayConnections)
        .set({
          backfillCompletedAt: new Date(),
          backfillPaymentsIngested: summary.transactionsCreated,
          backfillStatus: `ok - ${summary.transactionsCreated} transactions, ${summary.clustersFlagged} groups flagged`,
        })
        .where(eq(razorpayConnections.id, conn.id))
    } catch (cause) {
      // A failed backfill must not look like a finished one. Leaving completedAt null is what
      // lets the dashboard say "history scan failed, retry" rather than "0 rings found".
      await db
        .update(razorpayConnections)
        .set({
          backfillStatus: `failed: ${cause instanceof Error ? cause.message.slice(0, 240) : "unknown error"}`,
        })
        .where(eq(razorpayConnections.id, conn.id))
    }
  })()
}
