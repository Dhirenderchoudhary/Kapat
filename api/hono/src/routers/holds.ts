import { sValidator } from "@hono/standard-validator"
import { accounts, auditLog, db, paymentHolds } from "@packages/db"
import { and, desc, eq, lt } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import {
  ApiError,
  conflictErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { capturePayment, refundPayment } from "@/lib/razorpay-capture"

// The merchant decision surface for held payments.
//
// The agent put money in a waiting room by declining to capture it. Everything here is a human
// taking it out again - releasing it to settle, or refunding it to the customer. Nothing in this
// file runs on a timer, and nothing calls it except a merchant clicking a button.

const HOLD_STATUSES = ["held", "released", "rejected", "expired"] as const

const decisionSchema = z.object({
  decidedBy: z.string().trim().min(1).max(200),
  // Required on reject, exactly like merchant_decisions.reason (Principle 10): a rejection
  // without a stated reason is how false-positive rates become unmeasurable.
  note: z.string().trim().max(2000).optional(),
})

const holdSchema = z.object({
  id: z.string(),
  razorpayPaymentId: z.string(),
  amountPaise: z.number(),
  currency: z.string(),
  status: z.enum(HOLD_STATUSES),
  riskScoreAtHold: z.number().nullable(),
  clusterId: z.string().nullable(),
  reason: z.string(),
  customerRef: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  razorpayResult: z.string().nullable(),
  authorizedAt: z.string(),
  expiresAt: z.string(),
  msUntilExpiry: z.number(),
})

/**
 * Marks holds whose 3-day window has passed as expired.
 *
 * Razorpay has already refunded these to the customer by this point - this only stops the dashboard
 * from offering a Release button that would fail. Run opportunistically on read rather than from a
 * cron: the only moment the state matters is when someone is looking at it, and a background job
 * would be one more thing to keep alive for no gain.
 */
async function sweepExpired(): Promise<number> {
  const result = await db
    .update(paymentHolds)
    .set({
      status: "expired",
      razorpayResult:
        "hold window elapsed - Razorpay auto-refunds uncaptured payments after 3 days",
    })
    .where(and(eq(paymentHolds.status, "held"), lt(paymentHolds.expiresAt, new Date())))
    .returning({ id: paymentHolds.id })
  return result.length
}

async function loadHolds(status?: (typeof HOLD_STATUSES)[number]) {
  const rows = await db
    .select({
      hold: paymentHolds,
      customerRef: accounts.customerRef,
    })
    .from(paymentHolds)
    .leftJoin(accounts, eq(paymentHolds.accountId, accounts.id))
    .where(status ? eq(paymentHolds.status, status) : undefined)
    .orderBy(desc(paymentHolds.createdAt))
    .limit(200)

  const now = Date.now()
  return rows.map(({ hold, customerRef }) => ({
    id: hold.id,
    razorpayPaymentId: hold.razorpayPaymentId,
    amountPaise: hold.amountPaise,
    currency: hold.currency,
    status: hold.status as (typeof HOLD_STATUSES)[number],
    riskScoreAtHold: hold.riskScoreAtHold,
    clusterId: hold.clusterId,
    reason: hold.reason,
    customerRef: customerRef ?? null,
    decidedBy: hold.decidedBy,
    decidedAt: hold.decidedAt ? hold.decidedAt.toISOString() : null,
    decisionNote: hold.decisionNote,
    razorpayResult: hold.razorpayResult,
    authorizedAt: hold.authorizedAt.toISOString(),
    expiresAt: hold.expiresAt.toISOString(),
    msUntilExpiry: hold.expiresAt.getTime() - now,
  }))
}

/** Loads a hold and refuses if it has already been decided. The guard is a compare-and-set on the
 *  UPDATE below, not this read - this only produces a friendly message (Principle 3). */
async function requireOpenHold(id: string) {
  const [row] = await db.select().from(paymentHolds).where(eq(paymentHolds.id, id)).limit(1)
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such hold.")
  if (row.status !== "held") {
    throw new ApiError(
      409,
      "CONFLICT",
      `This payment was already ${row.status}${row.decidedBy ? ` by ${row.decidedBy}` : ""}. A held payment can only be decided once.`,
    )
  }
  return row
}

export const holdsRouter = new Hono()
  .get(
    "/",
    describeRoute({
      tags: ["Holds"],
      description:
        "Payments the agent is holding for review, newest first. A held payment has the customer's funds reserved but NOT settled to the merchant - Razorpay auto-refunds it if nobody decides within 3 days, so msUntilExpiry is the number that matters.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  data: z.object({ holds: z.array(holdSchema), expiredNow: z.number() }),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const expiredNow = await sweepExpired()
      const status = c.req.query("status") as (typeof HOLD_STATUSES)[number] | undefined
      const holds = await loadHolds(HOLD_STATUSES.includes(status as never) ? status : undefined)
      return c.json({ data: { holds, expiredNow } })
    },
  )
  .post(
    "/:id/release",
    describeRoute({
      tags: ["Holds"],
      description:
        "Merchant releases a held payment: captures it via Razorpay so the funds settle. This is the ONLY path in the system that captures money, and it requires a named human decision.",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...notFoundErrorResponses,
        ...conflictErrorResponses,
      },
    }),
    sValidator("json", decisionSchema, (result) => {
      if (!result.success)
        throw new ApiError(400, "VALIDATION_ERROR", "A release must record who decided it.", {
          issues: result.error,
        })
    }),
    async (c) => {
      const id = c.req.param("id")
      const { decidedBy, note } = c.req.valid("json")
      const hold = await requireOpenHold(id)

      // Claim the hold BEFORE calling Razorpay. If two operators click Release at once, exactly one
      // wins the compare-and-set and only that one issues a capture - the loser gets a 409 rather
      // than both firing a capture at the same payment.
      const [claimed] = await db
        .update(paymentHolds)
        .set({ status: "released", decidedBy, decisionNote: note ?? null, decidedAt: new Date() })
        .where(and(eq(paymentHolds.id, id), eq(paymentHolds.status, "held")))
        .returning({ id: paymentHolds.id })
      if (!claimed) {
        throw new ApiError(
          409,
          "CONFLICT",
          "This payment was decided by someone else a moment ago.",
        )
      }

      const result = await capturePayment({
        paymentId: hold.razorpayPaymentId,
        amountPaise: hold.amountPaise,
        currency: hold.currency,
      })

      await db
        .update(paymentHolds)
        .set({ razorpayResult: result.detail })
        .where(eq(paymentHolds.id, id))

      if (hold.clusterId) {
        await db.insert(auditLog).values({
          clusterId: hold.clusterId,
          payload: {
            event: "hold_released",
            razorpayPaymentId: hold.razorpayPaymentId,
            amountPaise: hold.amountPaise,
            decidedBy,
            note: note ?? null,
            razorpayResult: result.detail,
            captureSucceeded: result.ok,
          },
        })
      }

      // A failed capture is reported, not swallowed. The row still says "released" because the
      // merchant did decide - but razorpayResult carries the failure so the dashboard can show that
      // the money did not actually settle and the window is still ticking.
      return c.json({
        data: {
          id,
          status: "released",
          captureSucceeded: result.ok,
          razorpayResult: result.detail,
        },
      })
    },
  )
  .post(
    "/:id/reject",
    describeRoute({
      tags: ["Holds"],
      description:
        "Merchant rejects a held payment: refunds the customer. Note what this is not - the customer gets their money back. Even the most negative decision available returns funds to the person who paid. A reason is required.",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...notFoundErrorResponses,
        ...conflictErrorResponses,
      },
    }),
    sValidator(
      "json",
      decisionSchema.refine((v) => Boolean(v.note && v.note.length > 0), {
        message: "A reason is required when rejecting a payment",
        path: ["note"],
      }),
      (result) => {
        if (!result.success)
          throw new ApiError(400, "VALIDATION_ERROR", "Rejecting a payment requires a reason.", {
            issues: result.error,
          })
      },
    ),
    async (c) => {
      const id = c.req.param("id")
      const { decidedBy, note } = c.req.valid("json")
      const hold = await requireOpenHold(id)

      const [claimed] = await db
        .update(paymentHolds)
        .set({ status: "rejected", decidedBy, decisionNote: note ?? null, decidedAt: new Date() })
        .where(and(eq(paymentHolds.id, id), eq(paymentHolds.status, "held")))
        .returning({ id: paymentHolds.id })
      if (!claimed) {
        throw new ApiError(
          409,
          "CONFLICT",
          "This payment was decided by someone else a moment ago.",
        )
      }

      const result = await refundPayment({
        paymentId: hold.razorpayPaymentId,
        amountPaise: hold.amountPaise,
        note,
      })

      await db
        .update(paymentHolds)
        .set({ razorpayResult: result.detail })
        .where(eq(paymentHolds.id, id))

      if (hold.clusterId) {
        await db.insert(auditLog).values({
          clusterId: hold.clusterId,
          payload: {
            event: "hold_rejected",
            razorpayPaymentId: hold.razorpayPaymentId,
            amountPaise: hold.amountPaise,
            decidedBy,
            reason: note,
            razorpayResult: result.detail,
            refundSucceeded: result.ok,
            note: "Customer was refunded. No money was withheld from anyone.",
          },
        })
      }

      return c.json({
        data: { id, status: "rejected", refundSucceeded: result.ok, razorpayResult: result.detail },
      })
    },
  )
