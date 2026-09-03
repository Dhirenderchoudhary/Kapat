import { db, razorpayConnections } from "@packages/db"
import { and, desc, eq, gt, isNotNull } from "drizzle-orm"

import { runSync } from "@/lib/razorpay-sync"

/**
 * The background poller: what makes "connect once and forget about it" true.
 *
 * THE PROBLEM IT SOLVES
 * =====================
 * Before this, a connected merchant still had to come back and press "run analysis" for anything
 * to happen. That is not a risk product; that is a report you have to remember to run. A fraud
 * ring that forms on a Tuesday should be on the dashboard on Tuesday.
 *
 * WHY POLLING AND NOT ONLY WEBHOOKS
 * =================================
 * The webhook path (routers/webhooks.ts) is genuinely real-time and is the primary route: a
 * payment.authorized event gets scored and held within seconds. But it only works once the
 * merchant has configured a webhook in their Razorpay dashboard and the endpoint is publicly
 * reachable, and neither is true for every merchant on day one. Polling is the floor: it needs no
 * configuration, no public URL, and no write scope on the merchant's account. Between the two,
 * a merchant is covered from the moment they paste a key.
 *
 * WHY THE SESSION EXPIRES
 * =======================
 * The poller ignores a connection past its expiresAt. A stored API secret that keeps working
 * forever is a liability nobody revisits; a 30-day session forces the merchant to re-consent while
 * they still remember granting it. Expiry is a feature, not a limitation, and the dashboard warns
 * before it lands rather than going quiet.
 *
 * SAFETY
 * ======
 * - One run at a time, process-wide. A slow sync must not overlap itself and double-ingest.
 * - Every failure is swallowed into the connection row's status, never thrown: an unhandled
 *   rejection on a timer takes the whole API process down, and a fraud dashboard that dies at 3am
 *   because Razorpay returned a 502 is worse than one that is briefly stale.
 * - Read-only against Razorpay. This never captures, refunds, or modifies anything.
 */

/** Five minutes: fast enough that a ring is visible the same session it forms, slow enough that a
 *  merchant's rate limit is never a concern (one paged read per interval). */
const POLL_INTERVAL_MS = 5 * 60 * 1000

/** How long a connection stays live before the merchant must reconnect. */
export const SESSION_DAYS = 30

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)
}

let running = false
let timer: ReturnType<typeof setInterval> | null = null

async function tick(origin: string): Promise<void> {
  if (running) return
  running = true
  try {
    const [conn] = await db
      .select()
      .from(razorpayConnections)
      .where(
        and(
          eq(razorpayConnections.autoSyncEnabled, true),
          isNotNull(razorpayConnections.expiresAt),
          gt(razorpayConnections.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(razorpayConnections.createdAt))
      .limit(1)

    if (!conn) return

    await db
      .update(razorpayConnections)
      .set({ lastAutoSyncAt: new Date() })
      .where(eq(razorpayConnections.id, conn.id))

    await runSync(conn, origin)
  } catch (cause) {
    // Deliberately swallowed - see the SAFETY note above. The status column is the record.
    console.warn(
      "[razorpay-poller] sync failed:",
      cause instanceof Error ? cause.message : String(cause),
    )
  } finally {
    running = false
  }
}

/**
 * Starts the poller. Safe to call more than once; only the first call arms a timer.
 *
 * Skipped entirely on serverless, where a process-lifetime timer is meaningless: the instance is
 * frozen between requests, so the interval either never fires or fires unpredictably. There the
 * correct trigger is the webhook plus an external cron hitting POST /api/razorpay/sync, and
 * pretending otherwise would leave a merchant believing they were covered when they were not.
 */
export function startRazorpayPoller(origin: string): void {
  if (timer) return
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return

  timer = setInterval(() => void tick(origin), POLL_INTERVAL_MS)
  // Node/Bun: do not hold the process open just for this.
  if (typeof timer === "object" && timer && "unref" in timer) {
    ;(timer as { unref: () => void }).unref()
  }
  // One run shortly after boot, so a restart does not mean waiting a full interval for the first
  // check. Delayed rather than immediate so the HTTP server is listening first - runSync calls
  // this same process over HTTP.
  setTimeout(() => void tick(origin), 15_000)
}
