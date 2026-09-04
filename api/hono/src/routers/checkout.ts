import { sValidator } from "@hono/standard-validator"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import { ApiError, validationErrorResponses } from "@/lib/error"
import { jsonRequestBody } from "@/lib/openapi"
import { verifyCheckoutSignature } from "@/lib/razorpay-signatures"

// Razorpay Standard Web Checkout (docs: /payments/payment-gateway/web-integration/standard).
//
// Exists in a fraud-detection product for one reason: to produce real payments to detect. Making a
// test payment through Checkout fires a real webhook, which the agent ingests and scores live -
// which is the only honest way to demonstrate live detection end to end.
//
// Implemented with plain fetch + node:crypto rather than the `razorpay` npm SDK: the SDK could not
// be installed in any environment this project has run in (package registries return 403), and for
// two endpoints and one HMAC the SDK earns nothing. Same HTTP contract either
// way.

const RAZORPAY_API = "https://api.razorpay.com/v1"

// Razorpay's documented floor for order amount is 100 subunits for INR (₹1).
const MIN_AMOUNT_PAISE = 100

const createOrderSchema = z.object({
  amountPaise: z.number().int().min(MIN_AMOUNT_PAISE).max(100_000_000),
  currency: z.string().trim().length(3).default("INR"),
  // Razorpay caps receipt at 40 characters.
  receipt: z.string().trim().max(40).optional(),
  notes: z.record(z.string(), z.string()).optional(),
})

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(200),
  razorpay_payment_id: z.string().trim().min(1).max(200),
  razorpay_signature: z.string().trim().min(1).max(400),
})

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new ApiError(
      503,
      "RAZORPAY_NOT_CONFIGURED",
      "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set on the server. Checkout cannot create orders without them.",
    )
  }
  return { keyId, keySecret }
}

export const checkoutRouter = new Hono()
  .get(
    "/config",
    describeRoute({
      tags: ["Checkout"],
      description:
        "Public checkout configuration - the key ID only. The key SECRET is never exposed here or anywhere else client-reachable; it exists solely to sign server-side.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  data: z.object({
                    keyId: z.string().nullable(),
                    configured: z.boolean(),
                    mode: z.enum(["live", "test"]),
                  }),
                }),
              ),
            },
          },
        },
      },
    }),
    (c) =>
      c.json({
        data: {
          keyId: process.env.RAZORPAY_KEY_ID ?? null,
          configured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
          mode: process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "live" : "test",
        },
      }),
  )
  .post(
    "/order",
    describeRoute({
      tags: ["Checkout"],
      description:
        "Creates a Razorpay Order (POST https://api.razorpay.com/v1/orders) and returns the order id the browser needs to open Checkout. Amount is in paise and must be at least 100.",
      ...jsonRequestBody(createOrderSchema),
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  data: z.object({
                    orderId: z.string(),
                    amount: z.number(),
                    currency: z.string(),
                    keyId: z.string(),
                  }),
                }),
              ),
            },
          },
        },
        ...validationErrorResponses,
      },
    }),
    sValidator("json", createOrderSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          `Invalid order request. Amount must be an integer of at least ${MIN_AMOUNT_PAISE} paise.`,
          { issues: result.error },
        )
      }
    }),
    async (c) => {
      const { keyId, keySecret } = credentials()
      const body = c.req.valid("json")

      let res: Response
      try {
        res = await fetch(`${RAZORPAY_API}/orders`, {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            amount: body.amountPaise,
            currency: body.currency,
            receipt: body.receipt ?? `rcpt_${Date.now()}`,
            notes: body.notes,
          }),
          signal: AbortSignal.timeout(20_000),
        })
      } catch (cause) {
        throw new ApiError(
          502,
          "RAZORPAY_UNREACHABLE",
          `Could not reach Razorpay: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }

      if (res.status === 401) {
        throw new ApiError(
          401,
          "RAZORPAY_AUTH_FAILED",
          "Razorpay rejected the API credentials (401). Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are a matching pair from the same mode.",
        )
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new ApiError(
          500,
          "RAZORPAY_ORDER_FAILED",
          `Razorpay returned ${res.status} creating the order. ${text.slice(0, 300)}`,
        )
      }

      const order = (await res.json()) as { id: string; amount: number; currency: string }
      return c.json({
        data: { orderId: order.id, amount: order.amount, currency: order.currency, keyId },
      })
    },
  )
  .post(
    "/verify",
    describeRoute({
      tags: ["Checkout"],
      description:
        "Verifies a completed Checkout payment: HMAC-SHA256 of `order_id|payment_id` with the API key secret, compared timing-safely against razorpay_signature. A mismatch returns 400 and the payment is NOT treated as successful. Detection is not run here - the webhook is the ingestion path, so a browser that never calls this cannot suppress a real payment from being analysed.",
      ...jsonRequestBody(verifyPaymentSchema),
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
      },
    }),
    sValidator("json", verifyPaymentSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "Missing or malformed payment verification fields",
          { issues: result.error },
        )
      }
    }),
    async (c) => {
      const { keySecret } = credentials()
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = c.req.valid("json")

      const valid = verifyCheckoutSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        keySecret,
      })

      if (!valid) {
        // 400, never 200-with-false: a caller that ignores the body must not read this as success.
        throw new ApiError(
          400,
          "SIGNATURE_MISMATCH",
          "Payment signature did not verify. This payment has NOT been accepted as genuine.",
        )
      }

      return c.json({
        data: {
          verified: true,
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          note: "Signature verified. Fraud analysis happens from the webhook, independently of this call.",
        },
      })
    },
  )
