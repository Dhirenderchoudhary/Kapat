/**
 * The only two Razorpay calls in this system that change money, and both require a merchant
 * decision to reach them.
 *
 * Rules.md Principle 1 is enforced structurally rather than by convention: neither function is
 * reachable from the detector, the webhook handler, or any scheduled job. The single call site of
 * each is the holds router, inside a handler that has already loaded a merchant-supplied
 * `decidedBy` and written it to the database. There is no code path from "the agent scored
 * something" to "money moved".
 *
 * NOT YET EXERCISED AGAINST THE LIVE API (Rules.md Principle 5): every environment this project has
 * run in blocks egress to api.razorpay.com, so these are written to Razorpay's published contract
 * and unit-tested against fixtures, but no real capture or refund has been performed. The first
 * merchant decision on a real hold is the first real test.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1"

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`
}

export type RazorpayActionResult = { ok: true; detail: string } | { ok: false; detail: string }

function credentials(): { keyId: string; keySecret: string } | null {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  return keyId && keySecret ? { keyId, keySecret } : null
}

/**
 * Releases a held payment: POST /v1/payments/:id/capture.
 *
 * Razorpay requires amount and currency on capture and rejects a mismatch against the authorized
 * amount - which is a genuine safety feature, not an annoyance: it makes it impossible to capture a
 * different sum than the customer authorized. The amount is therefore passed through from the hold
 * record, never recomputed.
 */
export async function capturePayment(params: {
  paymentId: string
  amountPaise: number
  currency: string
}): Promise<RazorpayActionResult> {
  const creds = credentials()
  if (!creds)
    return {
      ok: false,
      detail: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not configured on the server.",
    }

  try {
    const res = await fetch(
      `${RAZORPAY_API}/payments/${encodeURIComponent(params.paymentId)}/capture`,
      {
        method: "POST",
        headers: {
          authorization: authHeader(creds.keyId, creds.keySecret),
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount: params.amountPaise, currency: params.currency }),
        signal: AbortSignal.timeout(20_000),
      },
    )
    const text = await res.text().catch(() => "")
    if (!res.ok)
      return {
        ok: false,
        detail: `Razorpay returned ${res.status} on capture. ${text.slice(0, 300)}`,
      }
    return { ok: true, detail: "captured" }
  } catch (cause) {
    return {
      ok: false,
      detail: `Could not reach Razorpay: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

/**
 * Rejects a held payment by refunding the customer: POST /v1/payments/:id/refund.
 *
 * Note what this is NOT: it is not a punishment or a block. The customer gets their money back.
 * Even the merchant's most negative available decision returns funds to the person who paid - the
 * system has no mechanism to seize or withhold anyone's money, and deliberately so.
 */
export async function refundPayment(params: {
  paymentId: string
  amountPaise: number
  note?: string
}): Promise<RazorpayActionResult> {
  const creds = credentials()
  if (!creds)
    return {
      ok: false,
      detail: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not configured on the server.",
    }

  try {
    const res = await fetch(
      `${RAZORPAY_API}/payments/${encodeURIComponent(params.paymentId)}/refund`,
      {
        method: "POST",
        headers: {
          authorization: authHeader(creds.keyId, creds.keySecret),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          amount: params.amountPaise,
          notes: { reason: (params.note ?? "merchant rejected a held payment").slice(0, 250) },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    )
    const text = await res.text().catch(() => "")
    if (!res.ok)
      return {
        ok: false,
        detail: `Razorpay returned ${res.status} on refund. ${text.slice(0, 300)}`,
      }
    return { ok: true, detail: "refunded" }
  } catch (cause) {
    return {
      ok: false,
      detail: `Could not reach Razorpay: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

/** Razorpay auto-refunds an authorized payment that is never captured within 3 days of creation. */
export const HOLD_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

export function holdExpiry(authorizedAt: Date): Date {
  return new Date(authorizedAt.getTime() + HOLD_WINDOW_MS)
}
