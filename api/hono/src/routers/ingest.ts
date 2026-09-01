import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { sValidator } from "@hono/standard-validator"
import { accounts, db, transactions } from "@packages/db"
import { inArray } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import { ApiError, validationErrorResponses } from "@/lib/error"

// Bulk ingestion (Architecture.md §6's webhook contract, widened for the case a merchant actually
// has on day one: a CSV exported from their payment dashboard, not a live webhook subscription).
//
// POST /webhooks/razorpay stays the single-event path. This router is the same guarantees applied
// to many rows at once: accounts upsert on customer_ref, transactions upsert on
// razorpay_event_id, both ON CONFLICT DO NOTHING at the database level (Rules.md Principle 3), so
// re-uploading the same export is a no-op rather than a duplicate-laden mess.

const MAX_ROWS = 50_000

const ingestRowSchema = z.object({
  // Optional: a merchant's export may have no stable event id. When absent we derive one from the
  // row's own content so a re-upload of the same file still collides and no-ops. Deriving rather
  // than random-generating is the whole point - a random id would defeat idempotency silently.
  eventId: z.string().trim().max(200).optional(),
  customerRef: z.string().trim().min(1).max(200),
  deliveryAddress: z.string().trim().max(500).optional(),
  paymentFingerprint: z.string().trim().max(200).optional(),
  phoneNumber: z.string().trim().max(50).optional(),
  amountPaise: z.number().int().min(0),
  promoCode: z.string().trim().max(100).optional(),
  createdAt: z.string().trim().min(1).max(64),
})

const ingestBodySchema = z.object({
  rows: z.array(ingestRowSchema).min(0).max(MAX_ROWS),
  // Names the upload in the response so the merchant can see what was counted; not persisted.
  sourceLabel: z.string().trim().max(200).optional(),
})

const ingestResponseSchema = z.object({
  rowsReceived: z.number(),
  accountsCreated: z.number(),
  transactionsCreated: z.number(),
  duplicatesSkipped: z.number(),
  signalCoverage: z.object({
    deliveryAddress: z.number(),
    paymentFingerprint: z.number(),
    phoneNumber: z.number(),
    promoCode: z.number(),
  }),
})

function deriveEventId(row: z.infer<typeof ingestRowSchema>): string {
  const basis = [row.customerRef, row.amountPaise, row.createdAt, row.promoCode ?? ""].join("|")
  return `csv_${createHash("sha256").update(basis).digest("hex").slice(0, 32)}`
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    // Epoch seconds are extremely common in payment exports - accept them rather than rejecting a
    // whole upload over a format the merchant didn't choose.
    const asNumber = Number(value)
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
    }
    throw new ApiError(400, "VALIDATION_ERROR", `Unparseable timestamp: "${value}"`)
  }
  return parsed
}

async function ingestRows(rows: z.infer<typeof ingestRowSchema>[]) {
  if (rows.length === 0) {
    return {
      rowsReceived: 0,
      accountsCreated: 0,
      transactionsCreated: 0,
      duplicatesSkipped: 0,
      signalCoverage: {
        deliveryAddress: 0,
        paymentFingerprint: 0,
        phoneNumber: 0,
        promoCode: 0,
      },
    }
  }

  // One account per distinct customer_ref in the upload. Collapsing here rather than inserting
  // per-row keeps a 50k-row file from issuing 50k redundant upserts for a few thousand customers.
  const byCustomer = new Map<string, z.infer<typeof ingestRowSchema>>()
  for (const row of rows) {
    const existing = byCustomer.get(row.customerRef)
    // Prefer the row that carries the most identifying detail - a merchant's export often has the
    // address on some rows and not others, and dropping it would silently cost a whole signal.
    const score = (r?: z.infer<typeof ingestRowSchema>) =>
      r ? [r.deliveryAddress, r.paymentFingerprint, r.phoneNumber].filter(Boolean).length : -1
    if (score(row) > score(existing)) byCustomer.set(row.customerRef, row)
  }

  const accountValues = Array.from(byCustomer.values()).map((r) => ({
    customerRef: r.customerRef,
    deliveryAddress: r.deliveryAddress ?? null,
    paymentMethodFingerprint: r.paymentFingerprint ?? null,
    phoneNumber: r.phoneNumber ?? null,
  }))

  let accountsCreated = 0
  const CHUNK = 500
  for (let i = 0; i < accountValues.length; i += CHUNK) {
    const inserted = await db
      .insert(accounts)
      .values(accountValues.slice(i, i + CHUNK))
      .onConflictDoNothing({ target: accounts.customerRef })
      .returning({ id: accounts.id })
    accountsCreated += inserted.length
  }

  // Resolve every customer_ref to its account id - including the ones that already existed and so
  // returned nothing from the insert above.
  const idByCustomer = new Map<string, string>()
  const allRefs = Array.from(byCustomer.keys())
  for (let i = 0; i < allRefs.length; i += CHUNK) {
    const found = await db
      .select({ id: accounts.id, customerRef: accounts.customerRef })
      .from(accounts)
      // One round trip per chunk rather than per customer_ref.
      .where(inArray(accounts.customerRef, allRefs.slice(i, i + CHUNK)))
    for (const row of found) idByCustomer.set(row.customerRef, row.id)
  }

  const txnValues = rows
    .map((r) => {
      const accountId = idByCustomer.get(r.customerRef)
      if (!accountId) return null
      return {
        razorpayEventId: r.eventId?.trim() ? r.eventId.trim() : deriveEventId(r),
        accountId,
        amountPaise: r.amountPaise,
        promoCode: r.promoCode ?? null,
        createdAt: parseTimestamp(r.createdAt),
      }
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)

  // De-duplicate within the upload itself before hitting the database: ON CONFLICT DO NOTHING
  // cannot resolve two identical event ids inside a single INSERT statement.
  const seen = new Set<string>()
  const uniqueTxns = txnValues.filter((t) => {
    if (seen.has(t.razorpayEventId)) return false
    seen.add(t.razorpayEventId)
    return true
  })

  let transactionsCreated = 0
  for (let i = 0; i < uniqueTxns.length; i += CHUNK) {
    const inserted = await db
      .insert(transactions)
      .values(uniqueTxns.slice(i, i + CHUNK))
      .onConflictDoNothing({ target: transactions.razorpayEventId })
      .returning({ id: transactions.id })
    transactionsCreated += inserted.length
  }

  return {
    rowsReceived: rows.length,
    accountsCreated,
    transactionsCreated,
    duplicatesSkipped: rows.length - transactionsCreated,
    signalCoverage: {
      deliveryAddress: rows.filter((r) => r.deliveryAddress).length,
      paymentFingerprint: rows.filter((r) => r.paymentFingerprint).length,
      phoneNumber: rows.filter((r) => r.phoneNumber).length,
      promoCode: rows.filter((r) => r.promoCode).length,
    },
  }
}

const DATA_DIR = process.env.METRICS_DATA_DIR ?? resolve(import.meta.dir, "../../../../data")
import detectorTest from "../../../../data/detector_test.json" with { type: "json" }
import detectorTrain from "../../../../data/detector_train.json" with { type: "json" }

export const ingestRouter = new Hono()
  .post(
    "/transactions",
    describeRoute({
      tags: ["Ingest"],
      description:
        "Bulk-ingest mapped transaction rows (e.g. a CSV a merchant exported from their payment dashboard). Idempotent on razorpay_event_id and customer_ref at the database level, so re-uploading the same file adds nothing (Rules.md Principle 3). Ingestion only stores accounts and transactions - it does not run detection; call POST /api/clusters/detect for that.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: ingestResponseSchema })) },
          },
        },
        ...validationErrorResponses,
      },
    }),
    sValidator("json", ingestBodySchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid ingest payload", {
          issues: result.error,
        })
      }
    }),
    async (c) => {
      const { rows } = c.req.valid("json")
      return c.json({ data: await ingestRows(rows) })
    },
  )
  .post(
    "/demo",
    describeRoute({
      tags: ["Ingest"],
      description:
        "Loads the bundled synthetic dataset (data/detector_train.json + detector_test.json - 396 accounts, 949 transactions, containing real rings, legitimate look-alike households and ordinary baseline traffic) so the product can be evaluated in a browser without a terminal. Same idempotent path as a CSV upload; safe to call twice.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: ingestResponseSchema })) },
          },
        },
      },
    }),
    async (c) => {
      type RawAccount = {
        id: string
        customer_ref: string
        delivery_address?: string | null
        payment_method_fingerprint?: string | null
        phone_number?: string | null
      }
      type RawTxn = {
        razorpay_event_id: string
        account_id: string
        amount_paise: number
        promo_code?: string | null
        created_at: string
      }

      let accountsRaw: RawAccount[] = []
      let txnsRaw: RawTxn[] = []

      try {
        const trainParsed = detectorTrain as { accounts?: RawAccount[]; transactions?: RawTxn[] }
        const testParsed = detectorTest as { accounts?: RawAccount[]; transactions?: RawTxn[] }
        accountsRaw = (trainParsed.accounts ?? []).concat(testParsed.accounts ?? [])
        txnsRaw = (trainParsed.transactions ?? []).concat(testParsed.transactions ?? [])
      } catch {
        for (const file of ["detector_train.json", "detector_test.json"]) {
          try {
            const parsed = JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8"))
            accountsRaw = accountsRaw.concat(parsed.accounts ?? [])
            txnsRaw = txnsRaw.concat(parsed.transactions ?? [])
          } catch {
            throw new ApiError(
              503,
              "DEMO_DATA_UNAVAILABLE",
              `Could not read ${file} from ${DATA_DIR}.`,
            )
          }
        }
      }

      const addressById = new Map(accountsRaw.map((a) => [a.id, a]))
      const rows = txnsRaw.map((t) => {
        const acc = addressById.get(t.account_id)
        return {
          eventId: t.razorpay_event_id,
          customerRef: acc?.customer_ref ?? t.account_id,
          deliveryAddress: acc?.delivery_address ?? undefined,
          paymentFingerprint: acc?.payment_method_fingerprint ?? undefined,
          phoneNumber: acc?.phone_number ?? undefined,
          amountPaise: t.amount_paise,
          promoCode: t.promo_code ?? undefined,
          createdAt: t.created_at,
        }
      })

      return c.json({ data: await ingestRows(rows) })
    },
  )
