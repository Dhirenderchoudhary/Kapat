import assert from "node:assert/strict"
import { test } from "node:test"

import {
  parseCustomerReply,
  parseMerchantReply,
  scriptFor,
} from "../api/hono/src/lib/voice-scripts.ts"

test("merchant English opening asks cancel vs release", () => {
  const text = scriptFor("merchant", "en-IN", "opening")
  assert.match(text, /cancel/i)
  assert.match(text, /hold/i)
  assert.match(text, /Razorpay/i)
})

test("merchant Hindi and Marathi openings are native-script", () => {
  assert.match(scriptFor("merchant", "hi-IN", "opening"), /नमस्ते/)
  assert.match(scriptFor("merchant", "mr-IN", "opening"), /नमस्कार/)
})

test("merchant reply parser", () => {
  assert.equal(parseMerchantReply("Yes, cancel the payment"), "cancel")
  assert.equal(parseMerchantReply("रद्द कर दो"), "cancel")
  assert.equal(parseMerchantReply("Release the hold"), "release")
  assert.equal(parseMerchantReply("होल्ड हटा दो"), "release")
  assert.equal(parseMerchantReply("hmm maybe"), "unclear")
})

test("customer reply parser keeps the ring inversion", () => {
  assert.equal(parseCustomerReply("Yes, that's my brother's account"), "confirmed_linked")
  assert.equal(parseCustomerReply("No, I have no idea what account"), "denied_linked")
})

test("closing line follows the parsed outcome", () => {
  assert.match(scriptFor("merchant", "en-IN", "closing", "cancel"), /cancel settlement/i)
  assert.match(scriptFor("merchant", "en-IN", "closing", "release"), /release the hold/i)
})
