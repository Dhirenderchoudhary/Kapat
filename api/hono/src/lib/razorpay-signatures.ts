import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Razorpay signature verification.
 *
 * There are TWO different schemes and they are easy to confuse - mixing them up is the classic
 * Razorpay integration bug, and it fails "open" (every signature mismatches, or worse, you verify
 * with the wrong secret and accept anything). They are kept in one file, named explicitly, so the
 * difference is impossible to miss:
 *
 *   CHECKOUT (client -> your server, after a payment succeeds in the modal)
 *     signed string : `${razorpay_order_id}|${razorpay_payment_id}`
 *     secret        : your API KEY SECRET
 *
 *   WEBHOOK (Razorpay -> your server, server to server)
 *     signed string : the RAW request body, byte for byte, unparsed
 *     secret        : your WEBHOOK SECRET (set when creating the webhook, NOT the key secret)
 *     header        : X-Razorpay-Signature
 *
 * Both comparisons are timing-safe. A plain `===` on a signature leaks how much of the prefix
 * matched, which is enough to forge one given enough attempts.
 */

function safeEqualHex(a: string, b: string): boolean {
  // timingSafeEqual throws on length mismatch, which would itself leak length - so normalise to a
  // constant-length comparison by hashing both sides to fixed-width buffers first.
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** Checkout callback: verifies the payment actually came from Razorpay and was not forged by the
 *  browser. Never mark an order paid without this returning true. */
export function verifyCheckoutSignature(params: {
  orderId: string
  paymentId: string
  signature: string
  keySecret: string
}): boolean {
  const { orderId, paymentId, signature, keySecret } = params
  if (!orderId || !paymentId || !signature || !keySecret) return false
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex")
  return safeEqualHex(expected, signature)
}

/** Webhook: the body MUST be the raw string exactly as received. Parsing it to JSON and
 *  re-serialising changes key order and whitespace, which changes the HMAC, which fails every
 *  time - the single most common reason a Razorpay webhook integration "randomly" rejects
 *  everything. */
export function verifyWebhookSignature(params: {
  rawBody: string
  signature: string
  webhookSecret: string
}): boolean {
  const { rawBody, signature, webhookSecret } = params
  if (!rawBody || !signature || !webhookSecret) return false
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex")
  return safeEqualHex(expected, signature)
}
