"use client"

import {
  RiArrowDownLine,
  RiArrowRightLine,
  RiArrowUpLine,
  RiLoader4Line,
  RiUserSharedLine,
} from "@remixicon/react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { LinkPending, RouteProgress } from "@/components/common/route-progress"
import {
  bySignalWeight,
  riskBand,
  RISK_BAND_LABEL,
  RISK_BAND_STYLE,
  signalClassOf,
  SIGNAL_CLASS_STYLE,
  SIGNAL_LABEL,
  SIGNAL_SHORT_LABEL,
} from "@/components/fraud/signal-taxonomy"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export interface QueueRow {
  id: string
  riskScore: number
  status: string
  chargebackExposurePaise: number | null
  accountCount: number
  verificationStatus: string
  createdAt: string
  signalTypes: string[]
}

const VERIFICATION_LABEL: Record<string, string> = {
  not_yet_triggered: "Not called",
  verified_legitimate: "Says legitimate",
  verified_linked: "Denied knowing",
  unclear: "Unclear",
  no_response: "No response",
}

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Awaiting decision",
  pending_verification: "Voice AI calling",
  resolved: "Decided",
}

function formatRupees(paise: number | null): string {
  if (paise === null) return "₹0"
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

/**
 * The filters a reviewer actually reaches for, and nothing else. Each one answers a question
 * someone asks out loud at this screen: what is worst, what has evidence no household produces,
 * what is still on me, what is already done. A filter matching nothing is hidden rather than shown
 * disabled, because an empty bucket is not a thing to click.
 */
type FilterKey = "all" | "critical" | "strong" | "open" | "decided"

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All",
  critical: "Critical",
  strong: "Strong evidence",
  open: "Awaiting decision",
  decided: "Decided",
}

const FILTERS: Record<FilterKey, (row: QueueRow) => boolean> = {
  all: () => true,
  critical: (row) => riskBand(row.riskScore) === "critical",
  strong: (row) => row.signalTypes.some((s) => signalClassOf(s) === "strong_fraud_specific"),
  open: (row) => row.status !== "resolved",
  decided: (row) => row.status === "resolved",
}

type SortKey = "risk" | "exposure" | "accounts" | "detected"

const SORT_VALUE: Record<SortKey, (row: QueueRow) => number> = {
  risk: (row) => row.riskScore,
  exposure: (row) => row.chargebackExposurePaise ?? 0,
  accounts: (row) => row.accountCount,
  detected: (row) => new Date(row.createdAt).getTime(),
}

/**
 * The ring queue.
 *
 * Two things were wrong with the table this replaces, and both appeared the moment it held more
 * than three rows. Every row carried a score, an account count, a rupee figure and two status
 * words, which is the same shape for every row and answers none of "which of these is actually a
 * ring", so a reviewer opened all fifteen to find out. And there was no way to narrow the list at
 * all: no filter, no sort, not even a column header you could click.
 *
 * The row now carries the evidence, coloured by the same taxonomy the detail page and the charts
 * read, and the list can be cut down and re-ordered without leaving the page. Filtering runs over
 * rows that are already here rather than through the router: every console route is force-dynamic
 * against a separate API, and a round trip to hide four rows is not a trade worth making.
 */
export function ClusterQueue({ rows }: { rows: QueueRow[] }) {
  const [filter, setFilter] = useState<FilterKey>("all")
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "risk", desc: true })

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>
    for (const key of Object.keys(FILTERS) as FilterKey[]) {
      out[key] = rows.filter(FILTERS[key]).length
    }
    return out
  }, [rows])

  const visible = useMemo(() => {
    const value = SORT_VALUE[sort.key]
    return rows
      .filter(FILTERS[filter])
      .slice()
      .sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)))
  }, [rows, filter, sort])

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: true }))

  const sortableHead = (key: SortKey, label: string, align: "left" | "right" = "left") => {
    const active = sort.key === key
    const Arrow = active && !sort.desc ? RiArrowUpLine : RiArrowDownLine
    return (
      <TableHead className="p-0">
        <button
          type="button"
          onClick={() => toggleSort(key)}
          aria-label={`Sort by ${label.toLowerCase()}`}
          className={cn(
            "hover:text-foreground focus-visible:ring-ring inline-flex w-full items-center gap-1 px-2 py-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
            align === "right" && "justify-end",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span>{label}</span>
          <Arrow className={cn("size-3.5", active ? "opacity-100" : "opacity-0")} aria-hidden />
        </button>
      </TableHead>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the queue">
        {(Object.keys(FILTER_LABEL) as FilterKey[])
          .filter((key) => key === "all" || counts[key] > 0)
          .map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "focus-visible:ring-ring rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                filter === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
              )}
            >
              {FILTER_LABEL[key]}
              <span className="ml-1.5 tabular-nums opacity-70">{counts[key]}</span>
            </button>
          ))}
      </div>

      {visible.length === 0 ? (
        <div className="glass-panel rounded-xl border p-10 text-center">
          <p className="text-foreground text-sm font-medium">
            Nothing in the queue matches {FILTER_LABEL[filter].toLowerCase()}.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setFilter("all")}>
            Show all {counts.all} groups
          </Button>
        </div>
      ) : (
        <div className="glass-panel overflow-x-auto rounded-xl border shadow-sm">
          <Table>
            <TableHeader>
              <tr className="bg-muted/40 border-b">
                {sortableHead("risk", "Risk")}
                {sortableHead("accounts", "Accounts")}
                <TableHead className="text-muted-foreground text-sm font-semibold">
                  Why it is flagged
                </TableHead>
                {sortableHead("exposure", "Exposure", "right")}
                <TableHead className="text-muted-foreground text-sm font-semibold">
                  Review
                </TableHead>
                {sortableHead("detected", "Detected")}
                <TableHead className="text-right">
                  <span className="sr-only">Open</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {visible.map((cluster) => {
                const band = riskBand(cluster.riskScore)
                const signals = cluster.signalTypes.slice().sort(bySignalWeight)
                const shown = signals.slice(0, 3)
                const rest = signals.length - shown.length
                return (
                  <TableRow key={cluster.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="text-foreground text-base font-bold tabular-nums">
                          {cluster.riskScore.toFixed(2)}
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            RISK_BAND_STYLE[band],
                          )}
                        >
                          {RISK_BAND_LABEL[band]}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-foreground flex items-center gap-1.5 font-medium tabular-nums">
                        <RiUserSharedLine className="text-muted-foreground size-4" aria-hidden />
                        <span>{cluster.accountCount}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {signals.length === 0 ? (
                        <span className="text-muted-foreground text-xs">No labelled links</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {shown.map((signal) => (
                            <span
                              key={signal}
                              title={SIGNAL_LABEL[signal] ?? signal}
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                                SIGNAL_CLASS_STYLE[signalClassOf(signal)],
                              )}
                            >
                              {SIGNAL_SHORT_LABEL[signal] ?? signal}
                            </span>
                          ))}
                          {rest > 0 && (
                            <span
                              className="text-muted-foreground text-xs tabular-nums"
                              title={signals
                                .slice(3)
                                .map((s) => SIGNAL_LABEL[s] ?? s)
                                .join(", ")}
                            >
                              +{rest}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-foreground text-right font-semibold tabular-nums">
                      {formatRupees(cluster.chargebackExposurePaise)}
                    </TableCell>
                    <TableCell>
                      <div className="text-foreground text-sm">
                        {STATUS_LABEL[cluster.status] ?? cluster.status}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        Voice check:{" "}
                        {VERIFICATION_LABEL[cluster.verificationStatus] ??
                          cluster.verificationStatus}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(cluster.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* The click a reviewer thought had frozen the app. The route has a
                          loading.tsx for the router to prefetch and paint into, RouteProgress puts
                          a bar at the top of the window the moment the click lands, and LinkPending
                          swaps the arrow for a spinner so the feedback also lands on the control
                          that was actually pressed. */}
                      <Button
                        render={<Link href={`/clusters/${cluster.id}`} />}
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                      >
                        <span>Inspect</span>
                        <LinkPending
                          idle={<RiArrowRightLine className="size-3.5" aria-hidden />}
                          pending={<RiLoader4Line className="size-3.5 animate-spin" aria-hidden />}
                        />
                        <RouteProgress />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
