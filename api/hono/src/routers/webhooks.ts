import { accounts, db, transactions } from "@packages/db"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"

import { ApiError } from "@/lib/error"
import { decideHold, recordHold } from "@/lib/hold-decision"
import { mapPayment, type RazorpayPayment } from "@/lib/razorpay-client"
import { verifyWebhookSignature } from "@/lib/razorpay-signatures"

/**
 * POST /webhooks/razorpay - the live detection path.
 *
 * This is the heart of the product: a payment happens, Razorpay posts it here within seconds, the
 * account graph is updated, detection runs, and a ring appears on the merchant's dashboard without
 * anyone pressing anything. Everything else (CSV import, the sync-all button) is catch-up for
 * history; this is the part that works while the merchant sleeps.
 *
 * SIGNATURE VERIFICATION - the details that actually matter:
 *   - The signed value is the RAW request body, byte for byte. c.req.text() is read FIRST and the
 *     JSON is parsed from that same string. Parsing and re-serialising would reorder keys and
 *     change whitespace, changing the HMAC, and every webhook would fail verification. This is the
 *     single most common way a Razorpay webhook integration breaks.
 *   - The key is RAZORPAY_WEBHOOK_SECRET (chosen when creating the webhook in the dashboard), NOT
 *     the API key secret. Different secret, different scheme - see lib/razorpay-signatures.ts.
 *   - Comparison is timing-safe.
 *
 * If RAZORPAY_WEBHOOK_SECRET is unset the endpoint REFUSES the request (503) rather than accepting
 * unverified payloads. An unauthenticated webhook that writes to the fraud graph is an open door to
 * poisoning a merchant's detection with fabricated accounts, so there is no "skip verification for
 * now" mode.
 */

// Razorpay's payment lifecycle can deliver authorized before captured, and does not guarantee that
// order (their docs say so explicitly). Both carry a full payment entity, and ingestion is
// idempotent on payment id, so accepting both is safe and means detection sees a payment at the
// earliest moment it exists.
const INGESTIBLE_EVENTS = new Set(["payment.authorized", "payment.captured", "payment.failed"])

type RazorpayWebhookEnvelope = {
  entity?: string
  event?: string
  created_at?: number
  payload?: {
    payment?: { entity?: RazorpayPayment }
  }
}

export const webhooksRouter = new Hono().post(
  "/razorpay",
  describeRoute({
    tags: ["Webhooks"],
    description:
      "Receives Razorpay webhook events (payment.authorized / payment.captured / payment.failed), verifies X-Razorpay-Signature as HMAC-SHA256 of the raw body using RAZORPAY_WEBHOOK_SECRET, ingests the payment idempotently, and re-runs ring detection so a new ring surfaces on the dashboard within seconds. Idempotent end to end: Razorpay retries failed deliveries, and a redelivered event is a no-op (Principle 3).",
    responses: {
      200: { description: "Accepted" },
      400: { description: "Signature mismatch or malformed payload" },
      503: { description: "Webhook secret not configured" },
    },
  }),
  async (c) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!webhookSecret) {
      throw new ApiError(
        503,
        "WEBHOOK_SECRET_NOT_CONFIGURED",
        "RAZORPAY_WEBHOOK_SECRET is not set. Refusing to accept unverified webhook payloads - an unauthenticated write into the fraud graph would let anyone poison a merchant's detection.",
      )
    }

    // RAW body first. Never c.req.json() here - see the module docstring.
    const rawBody = await c.req.text()
    const signature = c.req.header("x-razorpay-signature") ?? ""

    if (!verifyWebhookSignature({ rawBody, signature, webhookSecret })) {
      throw new ApiError(
        400,
        "WEBHOOK_SIGNATURE_MISMATCH",
        "X-Razorpay-Signature did not verify against the raw request body. Rejected.",
      )
    }

    let envelope: RazorpayWebhookEnvelope
    try {
      envelope = JSON.parse(rawBody)
    } catch {
      throw new ApiError(400, "MALFORMED_PAYLOAD", "Webhook body verified but is not valid JSON.")
    }

    const event = envelope.event ?? ""
    const entity = envelope.payload?.payment?.entity

    // Acknowledge unknown events with 200. Razorpay retries non-2xx, so returning an error for an
    // event we simply don't consume would create an infinite retry loop for a non-problem.
    if (!INGESTIBLE_EVENTS.has(event) || !entity) {
      return c.json({
        data: {
          received: true,
          event,
          ingested: false,
          reason: "event not consumed by the detector",
        },
      })
    }

    const row = mapPayment(entity)
    if (!row) {
      return c.json({
        data: {
          received: true,
          event,
          ingested: false,
          reason: "payment entity missing amount or created_at",
        },
      })
    }

    // Upsert the account on customer_ref, then the transaction on the Razorpay payment id. Both
    // guarantees are database constraints, not application checks (Principle 3), so a
    // Razorpay retry - or two deliveries racing - cannot duplicate anything.
    const account = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(accounts)
        .values({
          customerRef: row.customerRef,
          deliveryAddress: row.deliveryAddress ?? null,
          paymentMethodFingerprint: row.paymentFingerprint ?? null,
          phoneNumber: row.phoneNumber ?? null,
        })
        .onConflictDoNothing({ target: accounts.customerRef })
        .returning()
      if (inserted) return inserted
      const [existing] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.customerRef, row.customerRef))
        .limit(1)
      return existing!
    })

    const [insertedTxn] = await db
      .insert(transactions)
      .values({
        razorpayEventId: row.eventId,
        accountId: account.id,
        amountPaise: row.amountPaise,
        promoCode: row.promoCode ?? null,
        createdAt: new Date(row.createdAt),
      })
      .onConflictDoNothing({ target: transactions.razorpayEventId })
      .returning()

    // Only re-run detection when something genuinely new landed. A redelivered event changes no
    // data, so re-scoring the whole graph for it would burn the detector service for nothing.
    let detection: { clustersFlagged: number; clustersNewlyPersisted: number } | null = null
    if (insertedTxn) {
      try {
        const origin = new URL(c.req.url).origin
        const res = await fetch(`${origin}/api/clusters/detect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
        if (res.ok) {
          const body = (await res.json()) as {
            data: { clustersFlagged: number; clustersNewlyPersisted: number }
          }
          detection = {
            clustersFlagged: body.data.clustersFlagged,
            clustersNewlyPersisted: body.data.clustersNewlyPersisted,
          }
        }
      } catch {
        // Detection failing must never fail the webhook. Razorpay retries non-2xx responses, and a
        // retry would re-ingest nothing (idempotent) while re-triggering the same broken detection
        // forever. The payment is safely stored; the next event or a manual scan will pick it up.
        detection = null
      }
    }

    // THE HOLD. Detection has just re-run above, so the graph already reflects this payment - the
    // decision is made against the freshest possible picture.
    //
    // Only payment.authorized is holdable, and that is not a limitation, it is the entire
    // mechanism: an authorized payment has the customer's funds reserved but NOT settled, and
    // Razorpay auto-refunds it after 3 days if nobody captures it. Declining to capture is the only
    // power the agent has, and it expires in the customer's favour. A payment.captured event has
    // already settled - there is nothing left to hold, and the agent will not reach for a refund to
    // simulate one (Principle 1: it does not move money, in either direction).
    let hold: { id: string; expiresAt: string; reason: string } | null = null
    if (insertedTxn && event === "payment.authorized") {
      const decision = await decideHold(account.id)
      if (decision.hold) {
        const recorded = await recordHold({
          razorpayPaymentId: row.eventId,
          razorpayOrderId: entity.order_id ?? null,
          accountId: account.id,
          amountPaise: row.amountPaise,
          currency: entity.currency ?? "INR",
          authorizedAt: new Date(row.createdAt),
          decision,
        })
        if (recorded) {
          hold = {
            id: recorded.id,
            expiresAt: recorded.expiresAt.toISOString(),
            reason: decision.reason,
          }
        }
      }
    }

    return c.json({
      data: {
        received: true,
        event,
        ingested: Boolean(insertedTxn),
        accountId: account.id,
        transactionId: insertedTxn?.id ?? null,
        detection,
        hold,
      },
    })
  },
)
