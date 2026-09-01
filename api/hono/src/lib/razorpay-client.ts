/**
 * Razorpay REST client - read-only.
 *
 * Only ever calls GET https://api.razorpay.com/v1/payments (Fetch All Payments, with
 * `expand[]=card`). It has no code path that can create, capture, refund or reverse anything, which
 * is the code-level version of the promise the product page makes: the agent cannot act on a
 * merchant's payments even if a bug tried to.
 *
 * Auth is HTTP Basic with key_id:key_secret, exactly as Razorpay's docs specify.
 *
 * NOT YET EXERCISED AGAINST THE LIVE API (Rules.md Principle 5). Every environment this project has
 * run in blocks egress to api.razorpay.com, so this client is written from Razorpay's published
 * request/response contract and is unit-testable against recorded fixtures, but has never completed
 * a real round trip. The first real sync is the test. Treat a first-run failure here as expected
 * integration work, not as a broken detector.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1"

// Razorpay caps `count` at 100 per Fetch All Payments; paginate with `skip`.
const PAGE_SIZE = 100

export type RazorpayPayment = {
  id: string
  entity: string
  amount: number
  currency: string
  status: string
  order_id: string | null
  method: string | null
  captured: boolean
  description: string | null
  card_id: string | null
  bank: string | null
  wallet: string | null
  vpa: string | null
  token_id?: string | null
  email: string | null
  contact: string | null
  notes: Record<string, string> | unknown[] | null
  created_at: number
  card?: { id?: string; last4?: string; network?: string; type?: string; issuer?: string } | null
}

export type MappedRow = {
  eventId: string
  customerRef: string
  deliveryAddress?: string
  paymentFingerprint?: string
  phoneNumber?: string
  promoCode?: string
  amountPaise: number
  createdAt: string
}

export class RazorpayError extends Error {
  // Explicit field rather than a TypeScript parameter property: parameter properties are a
  // TS-only *transform*, not a type annotation, so they cannot be stripped by Node's
  // --experimental-strip-types. Writing it out keeps this module directly runnable under plain
  // Node, which is what lets tests/test_razorpay_client.mjs execute it for real instead of only
  // type-checking it.
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = "RazorpayError"
    this.status = status
  }
}

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`
}

/** Verifies a credential pair by asking for a single payment. Cheapest possible real call - it
 *  proves the key works and the account is reachable without pulling any volume. */
export async function verifyCredentials(
  keyId: string,
  keySecret: string,
): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  try {
    const res = await fetch(`${RAZORPAY_API}/payments?count=1`, {
      headers: { authorization: authHeader(keyId, keySecret) },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        message:
          "Razorpay rejected those credentials (401). Check the key id and secret, and that both are from the same mode.",
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return {
        ok: false,
        status: res.status,
        message: `Razorpay returned ${res.status}. ${body.slice(0, 300)}`,
      }
    }
    return { ok: true }
  } catch (cause) {
    return {
      ok: false,
      message: `Could not reach api.razorpay.com: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

/** Notes is a free-form merchant dictionary. Razorpay's own docs sample uses {"address": "..."},
 *  and merchants commonly stash a coupon there too. Read it opportunistically - a merchant who
 *  happens to record these gets two extra detection signals for free, and one who doesn't loses
 *  nothing. Key matching is deliberately generous because nobody agrees on a name for these. */
function fromNotes(notes: RazorpayPayment["notes"], candidates: string[]): string | undefined {
  if (!notes || Array.isArray(notes)) return undefined
  for (const [rawKey, value] of Object.entries(notes)) {
    if (typeof value !== "string" || !value.trim()) continue
    const key = rawKey.toLowerCase().replace(/[\s-]/g, "_")
    if (candidates.some((c) => key === c || key.includes(c))) return value.trim().slice(0, 500)
  }
  return undefined
}

const ADDRESS_KEYS = ["address", "shipping", "delivery", "ship_to", "pincode", "postal"]
const PROMO_KEYS = ["promo", "coupon", "discount", "offer", "voucher"]

/**
 * Maps a Razorpay payment onto the detector's input row.
 *
 * Which signal each field unlocks:
 *   contact  -> phone_number          -> sequential SIM block (the strongest ring signal)
 *   card_id  -> payment fingerprint   -> shared payment method
 *   created_at -> timestamp           -> coordinated timing
 *   notes.*  -> address / promo       -> shared address, promo funnelling
 *
 * customerRef prefers email, falls back to contact, then to the payment id. Falling back to the
 * payment id is a deliberate degradation, not a bug: it makes that payment its own singleton
 * "customer", so it can never be wrongly grouped with anyone else. Inventing a shared identity for
 * contactless payments would manufacture ring evidence out of missing data.
 */
export function mapPayment(payment: RazorpayPayment): MappedRow | null {
  if (typeof payment.amount !== "number" || typeof payment.created_at !== "number") return null

  const customerRef = payment.email?.trim() || payment.contact?.trim() || payment.id
  // A card id is stable per stored card; vpa is the UPI handle; token_id covers saved tokens.
  // Any of the three identifies "the same instrument" well enough for a shared-payment edge.
  const fingerprint =
    payment.card?.id?.trim() ||
    payment.card_id?.trim() ||
    payment.vpa?.trim() ||
    payment.token_id?.trim() ||
    undefined

  return {
    eventId: payment.id,
    customerRef,
    phoneNumber: payment.contact?.trim() || undefined,
    paymentFingerprint: fingerprint,
    deliveryAddress: fromNotes(payment.notes, ADDRESS_KEYS),
    promoCode: fromNotes(payment.notes, PROMO_KEYS),
    amountPaise: payment.amount,
    createdAt: new Date(payment.created_at * 1000).toISOString(),
  }
}

/**
 * Pulls payments, newest page first, following `skip` until Razorpay runs out or maxRecords is hit.
 *
 * `from`/`to` are UNIX seconds per Razorpay's contract. onProgress is called per page so the UI can
 * show real progress instead of an indeterminate spinner on what may be a multi-minute pull.
 */
export async function fetchAllPayments(opts: {
  keyId: string
  keySecret: string
  from?: Date
  to?: Date
  maxRecords?: number
  onProgress?: (fetched: number) => void
}): Promise<RazorpayPayment[]> {
  const { keyId, keySecret, from, to, maxRecords = 10_000, onProgress } = opts
  const all: RazorpayPayment[] = []
  let skip = 0

  while (all.length < maxRecords) {
    const params = new URLSearchParams({ count: String(PAGE_SIZE), skip: String(skip) })
    // expand[]=card inlines the card object so a fingerprint doesn't cost one extra API call per
    // payment - which on a few thousand payments would be the difference between a sync that
    // finishes and one that gets rate-limited.
    params.append("expand[]", "card")
    if (from) params.set("from", String(Math.floor(from.getTime() / 1000)))
    if (to) params.set("to", String(Math.floor(to.getTime() / 1000)))

    let res: Response
    try {
      res = await fetch(`${RAZORPAY_API}/payments?${params.toString()}`, {
        headers: { authorization: authHeader(keyId, keySecret) },
        signal: AbortSignal.timeout(30_000),
      })
    } catch (cause) {
      throw new RazorpayError(
        `Network error talking to Razorpay after ${all.length} payments: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }

    if (res.status === 429) {
      throw new RazorpayError(
        `Razorpay rate-limited this sync after ${all.length} payments. Re-run it - already-ingested payments are skipped, so it resumes rather than starting over.`,
        429,
      )
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new RazorpayError(`Razorpay returned ${res.status}: ${body.slice(0, 300)}`, res.status)
    }

    const page = (await res.json()) as { count?: number; items?: RazorpayPayment[] }
    const items = page.items ?? []
    all.push(...items)
    onProgress?.(all.length)

    // A short page means the end of the collection.
    if (items.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }

  return all.slice(0, maxRecords)
}
