import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { test } from "node:test"

import {
  encryptSecret,
  decryptSecret,
  maskKeyId,
  credentialEncryptionAvailable,
} from "../api/hono/src/lib/crypto.ts"
import { mapPayment } from "../api/hono/src/lib/razorpay-client.ts"
import {
  verifyCheckoutSignature,
  verifySubscriptionSignature,
  verifyWebhookSignature,
} from "../api/hono/src/lib/razorpay-signatures.ts"

const KEY_SECRET = "jsZWeXvL95BT2qHjQB8L3KSb_EXAMPLE_NOT_REAL"
const WEBHOOK_SECRET = "whsec_example_not_real"

// ---------------------------------------------------------------- checkout signature
test("checkout: a signature Razorpay would produce verifies", () => {
  const orderId = "order_RB58MiP5SPFYyM"
  const paymentId = "pay_KbCFyQ0t9Lmi1n"
  // Exactly how Razorpay computes it, per their integration docs.
  const signature = createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex")
  assert.equal(
    verifyCheckoutSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET }),
    true,
  )
})

test("checkout: a tampered payment id is rejected", () => {
  const orderId = "order_RB58MiP5SPFYyM"
  const signature = createHmac("sha256", KEY_SECRET).update(`${orderId}|pay_REAL`).digest("hex")
  assert.equal(
    verifyCheckoutSignature({ orderId, paymentId: "pay_FORGED", signature, keySecret: KEY_SECRET }),
    false,
  )
})

test("checkout: the order/payment concatenation order matters (guards a silent field swap)", () => {
  const orderId = "order_A"
  const paymentId = "pay_B"
  const reversed = createHmac("sha256", KEY_SECRET).update(`${paymentId}|${orderId}`).digest("hex")
  assert.equal(
    verifyCheckoutSignature({ orderId, paymentId, signature: reversed, keySecret: KEY_SECRET }),
    false,
  )
})

test("checkout: wrong secret is rejected", () => {
  const orderId = "order_A",
    paymentId = "pay_B"
  const signature = createHmac("sha256", "some_other_secret")
    .update(`${orderId}|${paymentId}`)
    .digest("hex")
  assert.equal(
    verifyCheckoutSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET }),
    false,
  )
})

test("checkout: empty/missing inputs never verify", () => {
  assert.equal(
    verifyCheckoutSignature({ orderId: "", paymentId: "p", signature: "s", keySecret: KEY_SECRET }),
    false,
  )
  assert.equal(
    verifyCheckoutSignature({ orderId: "o", paymentId: "p", signature: "", keySecret: KEY_SECRET }),
    false,
  )
  assert.equal(
    verifyCheckoutSignature({ orderId: "o", paymentId: "p", signature: "s", keySecret: "" }),
    false,
  )
})

test("subscription: a signature Razorpay would produce verifies", () => {
  const paymentId = "pay_KbCFyQ0t9Lmi1n"
  const subscriptionId = "sub_RB58MiP5SPFYyM"
  const signature = createHmac("sha256", KEY_SECRET)
    .update(`${paymentId}|${subscriptionId}`)
    .digest("hex")
  assert.equal(
    verifySubscriptionSignature({ paymentId, subscriptionId, signature, keySecret: KEY_SECRET }),
    true,
  )
})

test("subscription: swapping payment and subscription ids is rejected", () => {
  const paymentId = "pay_A"
  const subscriptionId = "sub_B"
  const swapped = createHmac("sha256", KEY_SECRET)
    .update(`${subscriptionId}|${paymentId}`)
    .digest("hex")
  assert.equal(
    verifySubscriptionSignature({
      paymentId,
      subscriptionId,
      signature: swapped,
      keySecret: KEY_SECRET,
    }),
    false,
  )
})

// ---------------------------------------------------------------- webhook signature
test("webhook: signature over the RAW body verifies", () => {
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_1" } } },
  })
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")
  assert.equal(verifyWebhookSignature({ rawBody, signature, webhookSecret: WEBHOOK_SECRET }), true)
})

test("webhook: re-serialising the body breaks the signature (the classic integration bug)", () => {
  // Proves WHY the route must sign the raw string: parse + re-stringify reorders keys, and the
  // HMAC changes. If this test ever fails, someone made the route parse before verifying.
  const rawBody = '{"event":"payment.captured","account_id":"acc_1"}'
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")
  const reSerialised = JSON.stringify(
    JSON.parse('{"account_id":"acc_1","event":"payment.captured"}'),
  )
  assert.notEqual(reSerialised, rawBody)
  assert.equal(
    verifyWebhookSignature({ rawBody: reSerialised, signature, webhookSecret: WEBHOOK_SECRET }),
    false,
  )
})

test("webhook: the API key secret must NOT validate a webhook", () => {
  const rawBody = '{"event":"payment.captured"}'
  const signedWithKeySecret = createHmac("sha256", KEY_SECRET).update(rawBody).digest("hex")
  assert.equal(
    verifyWebhookSignature({
      rawBody,
      signature: signedWithKeySecret,
      webhookSecret: WEBHOOK_SECRET,
    }),
    false,
  )
})

test("webhook: a single flipped byte is rejected", () => {
  const rawBody = '{"event":"payment.captured","amount":50000}'
  const good = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")
  const bad = good.slice(0, -1) + (good.endsWith("a") ? "b" : "a")
  assert.equal(
    verifyWebhookSignature({ rawBody, signature: bad, webhookSecret: WEBHOOK_SECRET }),
    false,
  )
})

// ---------------------------------------------------------------- payment mapping
const BASE_PAYMENT = {
  id: "pay_KbCFyQ0t9Lmi1n",
  entity: "payment",
  amount: 50000,
  currency: "INR",
  status: "captured",
  order_id: "order_1",
  method: "card",
  captured: true,
  description: "Test",
  card_id: "card_ABC123",
  bank: null,
  wallet: null,
  vpa: null,
  email: "gaurav.kumar@gmail.com",
  contact: "+919000090000",
  notes: { address: "221B Baker St", coupon: "WELCOME50" },
  created_at: 1667397881,
}

test("mapPayment: pulls every one of the five detector signals from a real payment shape", () => {
  const row = mapPayment(structuredClone(BASE_PAYMENT))
  assert.equal(row.eventId, "pay_KbCFyQ0t9Lmi1n")
  assert.equal(row.customerRef, "gaurav.kumar@gmail.com")
  assert.equal(row.phoneNumber, "+919000090000") // -> sequential SIM block
  assert.equal(row.paymentFingerprint, "card_ABC123") // -> shared payment method
  assert.equal(row.deliveryAddress, "221B Baker St") // -> shared address (from notes)
  assert.equal(row.promoCode, "WELCOME50") // -> promo funnelling (from notes)
  assert.equal(row.amountPaise, 50000)
  assert.equal(row.createdAt, new Date(1667397881 * 1000).toISOString())
})

test("mapPayment: amount is passed through as paise, never rescaled", () => {
  // Razorpay already sends subunits. Any multiply/divide here would silently corrupt every
  // exposure figure on the dashboard.
  const row = mapPayment({ ...structuredClone(BASE_PAYMENT), amount: 199 })
  assert.equal(row.amountPaise, 199)
})

test("mapPayment: UPI payment uses the vpa as the instrument fingerprint", () => {
  const row = mapPayment({
    ...structuredClone(BASE_PAYMENT),
    card_id: null,
    card: null,
    vpa: "gaurav@okhdfc",
  })
  assert.equal(row.paymentFingerprint, "gaurav@okhdfc")
})

test("mapPayment: expanded card object wins over the bare card_id", () => {
  const row = mapPayment({ ...structuredClone(BASE_PAYMENT), card: { id: "card_EXPANDED" } })
  assert.equal(row.paymentFingerprint, "card_EXPANDED")
})

test("mapPayment: falls back email -> contact -> payment id for customer identity", () => {
  const noEmail = mapPayment({ ...structuredClone(BASE_PAYMENT), email: null })
  assert.equal(noEmail.customerRef, "+919000090000")

  const anonymous = mapPayment({ ...structuredClone(BASE_PAYMENT), email: null, contact: null })
  // Critical: an anonymous payment becomes its OWN singleton customer. If this ever returned a
  // shared constant, every contactless payment would collapse into one giant fake "ring".
  assert.equal(anonymous.customerRef, "pay_KbCFyQ0t9Lmi1n")
})

test("mapPayment: two anonymous payments never share an identity", () => {
  const a = mapPayment({
    ...structuredClone(BASE_PAYMENT),
    id: "pay_A",
    email: null,
    contact: null,
  })
  const b = mapPayment({
    ...structuredClone(BASE_PAYMENT),
    id: "pay_B",
    email: null,
    contact: null,
  })
  assert.notEqual(a.customerRef, b.customerRef)
})

test("mapPayment: notes keys are matched loosely but never invented", () => {
  const shipping = mapPayment({
    ...structuredClone(BASE_PAYMENT),
    notes: { shipping_address: "42 Nowhere Rd" },
  })
  assert.equal(shipping.deliveryAddress, "42 Nowhere Rd")

  const none = mapPayment({ ...structuredClone(BASE_PAYMENT), notes: {} })
  assert.equal(none.deliveryAddress, undefined)
  assert.equal(none.promoCode, undefined)
})

test("mapPayment: notes as an array (Razorpay sends [] when empty) does not crash", () => {
  const row = mapPayment({ ...structuredClone(BASE_PAYMENT), notes: [] })
  assert.equal(row.deliveryAddress, undefined)
})

test("mapPayment: rejects a payment with no amount or timestamp instead of guessing", () => {
  assert.equal(mapPayment({ ...structuredClone(BASE_PAYMENT), amount: null }), null)
  assert.equal(mapPayment({ ...structuredClone(BASE_PAYMENT), created_at: null }), null)
})

// ---------------------------------------------------------------- credential encryption
test("crypto: encrypt -> decrypt round-trips", () => {
  process.env.RAZORPAY_CREDENTIAL_KEY = "a-test-encryption-key-at-least-16-chars"
  const secret = "jsZWeXvL95BT2qHjQB8L3KSb"
  assert.equal(decryptSecret(encryptSecret(secret)), secret)
})

test("crypto: ciphertext differs every time (random IV), so it leaks no equality", () => {
  process.env.RAZORPAY_CREDENTIAL_KEY = "a-test-encryption-key-at-least-16-chars"
  assert.notEqual(encryptSecret("same"), encryptSecret("same"))
})

test("crypto: tampered ciphertext throws instead of returning garbage", () => {
  process.env.RAZORPAY_CREDENTIAL_KEY = "a-test-encryption-key-at-least-16-chars"
  const blob = encryptSecret("secret")
  const [iv, tag, data] = blob.split(".")
  const flipped = data.slice(0, -2) + (data.endsWith("AA") ? "BB" : "AA")
  assert.throws(() => decryptSecret([iv, tag, flipped].join(".")))
})

test("crypto: a different key cannot decrypt", () => {
  process.env.RAZORPAY_CREDENTIAL_KEY = "a-test-encryption-key-at-least-16-chars"
  const blob = encryptSecret("secret")
  process.env.RAZORPAY_CREDENTIAL_KEY = "a-DIFFERENT-encryption-key-16chars"
  assert.throws(() => decryptSecret(blob))
})

test("crypto: refuses to operate with no key set (no plaintext fallback)", () => {
  delete process.env.RAZORPAY_CREDENTIAL_KEY
  assert.equal(credentialEncryptionAvailable(), false)
  assert.throws(() => encryptSecret("secret"), /RAZORPAY_CREDENTIAL_KEY/)
})

test("crypto: maskKeyId never reveals the middle of a key", () => {
  const masked = maskKeyId("rzp_test_TWOYEAjzNT6zRd")
  assert.ok(masked.startsWith("rzp_test"))
  assert.ok(!masked.includes("TWOYEAjzNT"))
})
