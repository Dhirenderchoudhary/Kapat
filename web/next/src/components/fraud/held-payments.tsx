"use client"

import {
  RiAlarmWarningLine,
  RiCheckLine,
  RiRefund2Line,
  RiShieldCheckLine,
  RiTimeLine,
} from "@remixicon/react"
import { useCallback, useEffect, useState } from "react"

import { useT } from "@/components/fraud/locale"
import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"
import { cn } from "@/lib/utils"

type Hold = {
  id: string
  razorpayPaymentId: string
  amountPaise: number
  currency: string
  status: "held" | "released" | "rejected" | "expired"
  riskScoreAtHold: number | null
  clusterId: string | null
  reason: string
  customerRef: string | null
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  razorpayResult: string | null
  authorizedAt: string
  expiresAt: string
  msUntilExpiry: number
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Countdown to Razorpay's 3-day auto-refund. Deliberately blunt: this is a real deadline with real
 *  consequences, and a vague "expires soon" would let it pass unnoticed. */
function timeLeft(ms: number): { text: string; urgent: boolean } {
  if (ms <= 0) return { text: "expired", urgent: true }
  const hours = Math.floor(ms / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  if (hours >= 24) return { text: `${Math.floor(hours / 24)}d ${hours % 24}h`, urgent: false }
  if (hours >= 1) return { text: `${hours}h ${mins}m`, urgent: hours < 6 }
  return { text: `${mins}m`, urgent: true }
}

export function HeldPayments({ pollMs = 10_000 }: { pollMs?: number }) {
  const t = useT()
  const [holds, setHolds] = useState<Hold[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [decidedBy, setDecidedBy] = useState("")
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    const { data, error: err } = await unwrap(apiClient.holds.$get({ query: {} }))
    if (err) {
      // "Network request failed" on its own tells a merchant nothing and looks like the product is
      // broken. The overwhelmingly common cause is an API container still running a build from
      // before this endpoint existed, so say that rather than leaving them to guess.
      const raw = err.message ?? "request failed"
      setError(
        /network|fetch|failed|404/i.test(raw)
          ? `Could not reach the holds API (${raw}). If the API container is running an older build, this endpoint will not exist yet - rebuild with: docker compose up --build -d`
          : raw,
      )
    } else if (data) {
      setHolds((data as { holds: Hold[] }).holds)
      setError(null)
    }
  }, [])

  // Poll for new incidents. A held payment is time-critical, so the queue refreshes itself rather
  // than waiting for someone to hit reload.
  useEffect(() => {
    void load()
    const id = setInterval(load, pollMs)
    return () => clearInterval(id)
  }, [load, pollMs])

  // Re-render every 30s so the countdowns move without refetching.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  async function decide(hold: Hold, action: "release" | "reject") {
    setError(null)
    if (!decidedBy.trim()) {
      setError(t("hold.decidedBy"))
      return
    }
    const note = notes[hold.id]?.trim() ?? ""
    if (action === "reject" && !note) {
      setError(t("hold.reasonRequired"))
      return
    }
    setBusyId(hold.id)
    const res =
      action === "release"
        ? await unwrap(
            apiClient.holds[":id"].release.$post({
              param: { id: hold.id },
              json: { decidedBy: decidedBy.trim(), note: note || undefined },
            }),
          )
        : await unwrap(
            apiClient.holds[":id"].reject.$post({
              param: { id: hold.id },
              json: { decidedBy: decidedBy.trim(), note },
            }),
          )
    if (res.error) setError(res.error.message)
    await load()
    setBusyId(null)
  }

  const open = (holds ?? []).filter((h) => h.status === "held")
  const decided = (holds ?? []).filter((h) => h.status !== "held").slice(0, 10)

  return (
    <div className="space-y-6" data-tick={tick}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">{t("hold.subtitle")}</p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("hold.decidedBy")}</span>
          <input
            value={decidedBy}
            onChange={(e) => setDecidedBy(e.target.value)}
            className="bg-background h-9 w-44 rounded-md border px-2.5 text-sm"
            placeholder="e.g. Risk Ops"
          />
        </label>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {holds === null ? (
        <p className="text-muted-foreground text-sm">…</p>
      ) : open.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <RiShieldCheckLine className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">{t("hold.none")}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {open.map((hold) => {
            const left = timeLeft(hold.msUntilExpiry)
            return (
              <li
                key={hold.id}
                className={cn(
                  "glass-panel glass-card-hover relative overflow-hidden rounded-xl border p-5 shadow-sm transition-all",
                  left.urgent
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/80 bg-card/60",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                        <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                        {t("hold.heldLabel")}
                      </span>
                      <span className="text-foreground font-mono text-xs font-semibold">
                        {hold.razorpayPaymentId}
                      </span>
                      {hold.customerRef && (
                        <span className="text-muted-foreground font-mono text-xs">
                          {hold.customerRef}
                        </span>
                      )}
                    </div>
                    <div className="text-foreground mt-2 text-2xl font-bold tabular-nums sm:text-3xl">
                      {rupees(hold.amountPaise)}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2",
                      left.urgent
                        ? "border-destructive/40 bg-destructive/10 text-destructive animate-pulse"
                        : "border-border/80 bg-background/80 text-foreground",
                    )}
                  >
                    <RiTimeLine className="size-4" aria-hidden />
                    <div className="text-right">
                      <div className="text-[10px] font-semibold tracking-wider uppercase opacity-75">
                        {t("hold.expiresIn")}
                      </div>
                      <div className="text-base leading-tight font-bold tabular-nums">
                        {left.text}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-muted/30 border-border/70 mt-4 rounded-lg border p-3.5 text-sm">
                  <div className="text-foreground text-xs font-semibold tracking-wider uppercase">
                    {t("hold.reason")}
                  </div>
                  <p className="text-foreground mt-1 text-xs leading-relaxed sm:text-sm">
                    {hold.reason}
                  </p>
                  {hold.riskScoreAtHold !== null && (
                    <p className="text-muted-foreground mt-1.5 font-mono text-xs tabular-nums">
                      Corroboration risk score:{" "}
                      <strong className="text-foreground">{hold.riskScoreAtHold.toFixed(2)}</strong>
                    </p>
                  )}
                </div>

                <p className="text-muted-foreground mt-3 flex items-start gap-2 text-xs">
                  <RiAlarmWarningLine
                    className="mt-0.5 size-4 shrink-0 text-amber-500"
                    aria-hidden
                  />
                  <span>
                    {t("hold.notCancelled")} {t("hold.autoRefund")}
                  </span>
                </p>

                <input
                  value={notes[hold.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [hold.id]: e.target.value }))}
                  placeholder={t("hold.reason")}
                  className="bg-background/80 border-border/80 focus:ring-primary mt-4 h-9 w-full rounded-lg border px-3 text-xs shadow-xs transition-all sm:text-sm"
                />

                <div className="mt-3.5 flex flex-wrap gap-3">
                  <Button
                    onClick={() => decide(hold, "release")}
                    disabled={busyId === hold.id}
                    className="bg-emerald-600 text-white shadow-xs hover:bg-emerald-700"
                    size="sm"
                  >
                    <RiCheckLine className="size-4" aria-hidden />
                    {t("hold.release")}
                  </Button>
                  <Button
                    onClick={() => decide(hold, "reject")}
                    disabled={busyId === hold.id}
                    variant="destructive"
                    size="sm"
                    className="shadow-xs"
                  >
                    <RiRefund2Line className="size-4" aria-hidden />
                    {t("hold.reject")}
                  </Button>
                </div>
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {t("hold.releaseHint")} · {t("hold.rejectHint")}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {decided.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium">Recently decided</h2>
          <ul className="divide-y rounded-lg border">
            {decided.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <span className="font-mono text-xs">{h.razorpayPaymentId}</span>
                <span className="tabular-nums">{rupees(h.amountPaise)}</span>
                <span className="text-muted-foreground capitalize">{h.status}</span>
                <span className="text-muted-foreground text-xs">{h.decidedBy ?? "-"}</span>
                {h.razorpayResult && !["captured", "refunded"].includes(h.razorpayResult) && (
                  <span className="text-destructive text-xs">{h.razorpayResult.slice(0, 80)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-muted-foreground flex items-start gap-2 border-t pt-4 text-xs">
        <RiShieldCheckLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("hold.agentNeverActs")}
      </p>
    </div>
  )
}
