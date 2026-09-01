"use client"

import { RiCheckLine, RiCloseLine, RiFileTextLine, RiUploadCloud2Line } from "@remixicon/react"
import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"
import { cn } from "@/lib/utils"

/**
 * Merchant-facing CSV import.
 *
 * This exists because the honest answer to "how does a merchant analyse their own data today" was,
 * until now, "run a Python script and a curl command" - which is not a product. A merchant can
 * export transactions from their payment dashboard in one click; this turns that file into a run
 * of the detector without anyone touching a terminal, and without waiting on a live API
 * integration that does not exist yet.
 *
 * Parsing is done in the browser and only the mapped fields are sent. Columns the merchant does
 * not map never leave their machine - which matters, because a payments export contains far more
 * than this detector needs and there is no reason to transmit the rest.
 */

type FieldKey =
  | "customerRef"
  | "amount"
  | "createdAt"
  | "deliveryAddress"
  | "paymentFingerprint"
  | "phoneNumber"
  | "promoCode"
  | "eventId"

const FIELDS: {
  key: FieldKey
  label: string
  required: boolean
  hint: string
  /** Lowercased substrings we auto-match against the file's own headers. */
  match: string[]
  /** Which detector signal this column unlocks, if any. */
  signal?: string
}[] = [
  {
    key: "customerRef",
    label: "Customer identifier",
    required: true,
    hint: "Email, customer id, or contact: whatever identifies one buyer across orders.",
    match: ["customer_id", "customerid", "customer", "email", "contact", "buyer"],
  },
  {
    key: "amount",
    label: "Amount",
    required: true,
    hint: "Transaction value. Set the unit below.",
    match: ["amount", "value", "total", "price"],
  },
  {
    key: "createdAt",
    label: "Timestamp",
    required: true,
    hint: "When the transaction happened. ISO dates or epoch seconds both work.",
    match: ["created_at", "created", "date", "time", "authorized_at", "timestamp"],
    signal: "Coordinated timing",
  },
  {
    key: "phoneNumber",
    label: "Phone number",
    required: false,
    hint: "Unlocks sequential SIM-block detection: the single strongest ring signal.",
    match: ["phone", "contact", "mobile", "msisdn"],
    signal: "Sequential phone block",
  },
  {
    key: "deliveryAddress",
    label: "Delivery address",
    required: false,
    hint: "Usually lives in your order system rather than the payment export.",
    match: ["address", "shipping", "delivery", "ship_to"],
    signal: "Shared address",
  },
  {
    key: "paymentFingerprint",
    label: "Payment fingerprint",
    required: false,
    hint: "A card/UPI token or last-4 + issuer. Never send a full card number.",
    match: ["fingerprint", "card_id", "token", "last4", "vpa", "method_id"],
    signal: "Shared payment method",
  },
  {
    key: "promoCode",
    label: "Promo / coupon code",
    required: false,
    hint: "Unlocks promo-abuse detection, which is the loss class this is built for.",
    match: ["promo", "coupon", "discount", "offer", "voucher"],
    signal: "Promo funnelling",
  },
  {
    key: "eventId",
    label: "Transaction id",
    required: false,
    hint: "Used to de-duplicate re-uploads. Derived from the row if you leave this unmapped.",
    match: ["payment_id", "paymentid", "id", "transaction_id", "order_id"],
  },
]

/** Minimal RFC4180-ish parser: handles quoted fields, escaped quotes and embedded newlines. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      field = ""
      if (row.some((c) => c.trim() !== "")) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c.trim() !== "")) rows.push(row)

  const headers = (rows.shift() ?? []).map((h) => h.trim())
  return { headers, rows }
}

function autoMap(headers: string[]): Partial<Record<FieldKey, number>> {
  const mapping: Partial<Record<FieldKey, number>> = {}
  const used = new Set<number>()
  for (const field of FIELDS) {
    const idx = headers.findIndex((h, i) => {
      if (used.has(i)) return false
      const norm = h.toLowerCase().replace(/[\s-]/g, "_")
      return field.match.some((m) => norm === m || norm.includes(m))
    })
    if (idx >= 0) {
      mapping[field.key] = idx
      used.add(idx)
    }
  }
  return mapping
}

export function CsvImport() {
  const router = useRouter()
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, number>>>({})
  const [amountUnit, setAmountUnit] = useState<"paise" | "rupees">("rupees")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    accountsCreated: number
    transactionsCreated: number
  } | null>(null)

  const onFile = useCallback(async (file: File) => {
    setError(null)
    setResult(null)
    const text = await file.text()
    const { headers, rows } = parseCsv(text)
    if (headers.length === 0 || rows.length === 0) {
      setError("That file has no readable rows. Expected a CSV with a header row.")
      return
    }
    setFileName(file.name)
    setHeaders(headers)
    setRows(rows)
    setMapping(autoMap(headers))
  }, [])

  const ready =
    mapping.customerRef !== undefined &&
    mapping.amount !== undefined &&
    mapping.createdAt !== undefined

  const coverage = useMemo(() => {
    const signalFields = FIELDS.filter((f) => f.signal)
    return {
      available: signalFields.filter((f) => mapping[f.key] !== undefined),
      missing: signalFields.filter((f) => mapping[f.key] === undefined),
    }
  }, [mapping])

  async function runImport() {
    setBusy(true)
    setError(null)
    try {
      const get = (row: string[], key: FieldKey) => {
        const idx = mapping[key]
        if (idx === undefined) return undefined
        const v = row[idx]?.trim()
        return v ? v : undefined
      }

      const payload = rows
        .map((row) => {
          const customerRef = get(row, "customerRef")
          const rawAmount = get(row, "amount")
          const createdAt = get(row, "createdAt")
          if (!customerRef || !rawAmount || !createdAt) return null
          const numeric = Number(rawAmount.replace(/[^0-9.-]/g, ""))
          if (!Number.isFinite(numeric)) return null
          return {
            eventId: get(row, "eventId"),
            customerRef,
            deliveryAddress: get(row, "deliveryAddress"),
            paymentFingerprint: get(row, "paymentFingerprint"),
            phoneNumber: get(row, "phoneNumber"),
            promoCode: get(row, "promoCode"),
            amountPaise: Math.round(amountUnit === "rupees" ? numeric * 100 : numeric),
            createdAt,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      if (payload.length === 0) {
        setError("No rows had all three required fields filled in. Check the mapping above.")
        setBusy(false)
        return
      }

      const { data, error: err } = await unwrap(
        apiClient.ingest.transactions.$post({
          json: { rows: payload, sourceLabel: fileName ?? undefined },
        }),
      )
      if (err) {
        setError(err.message)
        setBusy(false)
        return
      }
      setResult({
        accountsCreated: (data as any).accountsCreated,
        transactionsCreated: (data as any).transactionsCreated,
      })

      const { error: detectErr } = await unwrap(apiClient.clusters.detect.$post({ json: {} }))
      if (detectErr) setError(`Imported, but detection failed: ${detectErr.message}`)
      else router.push("/clusters")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <label
        className={cn(
          "hover:bg-muted/40 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center transition-colors",
        )}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onFile(file)
          }}
        />
        <RiUploadCloud2Line className="text-muted-foreground size-8" aria-hidden />
        <span className="mt-3 font-medium">{fileName ?? "Choose a CSV export"}</span>
        <span className="text-muted-foreground mt-1 text-sm">
          {fileName
            ? `${rows.length.toLocaleString("en-IN")} rows · ${headers.length} columns`
            : "Parsed in your browser. Only the columns you map are sent."}
        </span>
      </label>

      {headers.length > 0 && (
        <>
          <div className="rounded-lg border">
            <div className="border-b p-4">
              <h3 className="text-sm font-medium">Map your columns</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                We guessed from your headers. Correct anything that&apos;s wrong: each optional
                column you map unlocks another detection signal.
              </p>
            </div>
            <div className="divide-y">
              {FIELDS.map((field) => (
                <div key={field.key} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-56 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {field.label}
                      {field.required && <span className="text-destructive text-xs">required</span>}
                      {field.signal && (
                        <span className="text-muted-foreground rounded-full border px-1.5 py-0.5 text-[11px]">
                          {field.signal}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">{field.hint}</p>
                  </div>
                  <select
                    className="bg-background h-9 min-w-48 rounded-md border px-2 text-sm"
                    value={mapping[field.key] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [field.key]: e.target.value === "" ? undefined : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="">(not in my file)</option>
                    {headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-56 flex-1 text-sm font-medium">Amount is in</div>
                <select
                  className="bg-background h-9 min-w-48 rounded-md border px-2 text-sm"
                  value={amountUnit}
                  onChange={(e) => setAmountUnit(e.target.value as "paise" | "rupees")}
                >
                  <option value="rupees">Rupees (e.g. 499.00)</option>
                  <option value="paise">Paise (e.g. 49900)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">
              Signals your file supports: {coverage.available.length} of{" "}
              {coverage.available.length + coverage.missing.length}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              The detector needs at least one signal a household doesn&apos;t produce. Timing alone
              is deliberately not enough to flag anyone.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {coverage.available.map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <RiCheckLine
                    className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                    aria-hidden
                  />
                  {f.signal}
                </li>
              ))}
              {coverage.missing.map((f) => (
                <li key={f.key} className="text-muted-foreground flex items-center gap-2">
                  <RiCloseLine className="size-4 shrink-0" aria-hidden />
                  {f.signal}: no column mapped
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runImport} disabled={!ready || busy} size="lg">
              <RiFileTextLine className="size-4" aria-hidden />
              {busy
                ? "Importing and scanning…"
                : `Import ${rows.length.toLocaleString("en-IN")} rows and run detection`}
            </Button>
            {!ready && (
              <p className="text-muted-foreground text-sm">
                Map customer identifier, amount and timestamp to continue.
              </p>
            )}
          </div>

          {result && (
            <p className="text-muted-foreground text-sm">
              Imported {result.transactionsCreated.toLocaleString("en-IN")} new transactions across{" "}
              {result.accountsCreated.toLocaleString("en-IN")} new accounts.
            </p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </>
      )}
    </div>
  )
}
