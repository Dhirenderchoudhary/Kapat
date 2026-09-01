import {
  RiAlarmWarningLine,
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiFlashlightLine,
  RiMoneyDollarCircleLine,
  RiShieldCheckLine,
  RiUserSharedLine,
} from "@remixicon/react"
import Link from "next/link"

import { LoadDemoData } from "@/components/fraud/load-demo-data"
import { RunDetection } from "@/components/fraud/run-detection"
import { RISK_BAND_LABEL, RISK_BAND_STYLE, riskBand } from "@/components/fraud/signal-taxonomy"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiClient, unwrap } from "@/lib/api/client"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function formatRupees(paise: number | null): string {
  if (paise === null) return "₹0"
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
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

export default async function ClustersPage() {
  const { data, error } = await unwrap(apiClient.clusters.$get({ query: {} }))

  const clusters = data?.clusters ?? []
  const open = clusters.filter((c) => c.status !== "resolved")
  const critical = clusters.filter((c) => riskBand(c.riskScore) === "critical")
  const totalExposure = clusters.reduce((sum, c) => sum + (c.chargebackExposurePaise ?? 0), 0)

  return (
    <PageShell size="lg" className="space-y-8">
      <PageHeader
        title="Ring Queue"
        description="Coordinated account groups surfaced by the corroboration graph detector. Ranked by risk score."
        actions={<RunDetection />}
      />

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-4 text-sm font-medium">
          Could not load ring queue: {error.message}
        </div>
      )}

      {!error && (
        <>
          {/* Headline Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Open Ring Cases
                </span>
                <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                  <RiAlarmWarningLine className="size-4.5" />
                </div>
              </div>
              <div className="text-foreground mt-2 text-3xl font-bold tabular-nums">
                {open.length}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                Awaiting merchant investigation
              </div>
            </div>

            <div className="glass-card-hover border-destructive/30 bg-destructive/5 rounded-xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-destructive text-xs font-semibold tracking-wider uppercase">
                  Critical Risk
                </span>
                <div className="bg-destructive/10 text-destructive flex size-8 animate-pulse items-center justify-center rounded-lg">
                  <RiFlashlightLine className="size-4.5" />
                </div>
              </div>
              <div className="text-destructive mt-2 text-3xl font-bold tabular-nums">
                {critical.length}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                Risk score &gt; 0.75 (High confidence)
              </div>
            </div>

            <div className="glass-card-hover rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                  Prevented Exposure
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <RiMoneyDollarCircleLine className="size-4.5" />
                </div>
              </div>
              <div className="text-foreground mt-2 text-3xl font-bold tabular-nums">
                {formatRupees(totalExposure)}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                Estimated volume across flagged accounts
              </div>
            </div>
          </div>

          {/* Queue Table or Empty State */}
          {clusters.length === 0 ? (
            <div className="glass-panel rounded-2xl border border-dashed p-12 text-center shadow-inner">
              <div className="bg-muted/60 text-muted-foreground mx-auto flex size-14 items-center justify-center rounded-2xl">
                <RiCheckboxCircleLine className="size-8 text-emerald-500" aria-hidden />
              </div>
              <h3 className="text-foreground mt-4 text-lg font-bold">No Fraud Rings Flagged</h3>
              <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
                Either no transactions have been ingested yet, or the corroboration engine found
                zero coordinated anomalies exceeding the flagging threshold.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <LoadDemoData />
                <Button render={<Link href="/connect" />} variant="outline" size="sm">
                  Connect Razorpay API
                </Button>
              </div>
            </div>
          ) : (
            <div className="glass-panel overflow-hidden rounded-xl border shadow-sm">
              <Table>
                <TableHeader>
                  <tr className="bg-muted/40 border-b">
                    <TableHead className="text-foreground font-semibold">Risk Band</TableHead>
                    <TableHead className="text-foreground font-semibold">Members</TableHead>
                    <TableHead className="text-foreground font-semibold">Total Exposure</TableHead>
                    <TableHead className="text-foreground font-semibold">
                      AI Voice Verification
                    </TableHead>
                    <TableHead className="text-foreground font-semibold">Decision Status</TableHead>
                    <TableHead className="text-foreground font-semibold">First Detected</TableHead>
                    <TableHead className="text-foreground text-right font-semibold">
                      Action
                    </TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {clusters.map((cluster) => {
                    const band = riskBand(cluster.riskScore)
                    return (
                      <TableRow key={cluster.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="text-foreground text-base font-bold tabular-nums">
                              {cluster.riskScore.toFixed(2)}
                            </span>
                            <span
                              className={cn(
                                "rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
                                RISK_BAND_STYLE[band],
                              )}
                            >
                              {RISK_BAND_LABEL[band]}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-foreground flex items-center gap-1.5 font-medium tabular-nums">
                            <RiUserSharedLine className="text-muted-foreground size-4" />
                            <span>{cluster.accountCount} accounts</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-foreground font-semibold tabular-nums">
                          {formatRupees(cluster.chargebackExposurePaise)}
                        </TableCell>
                        <TableCell>
                          <span className="bg-muted/60 text-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
                            {VERIFICATION_LABEL[cluster.verificationStatus] ??
                              cluster.verificationStatus}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                              cluster.status === "resolved"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                            )}
                          >
                            {STATUS_LABEL[cluster.status] ?? cluster.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(cluster.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            render={<Link href={`/clusters/${cluster.id}`} />}
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs"
                          >
                            <span>Inspect</span>
                            <RiArrowRightLine className="size-3.5" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="border-border/80 bg-muted/20 text-muted-foreground rounded-xl border p-4 text-xs">
            <div className="flex items-start gap-2.5">
              <RiShieldCheckLine className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
              <span>
                <strong>Human-in-the-loop:</strong> The detector surfaces coordinated clusters with
                transparent evidence logs. It never automatically blocks or freezes customer
                accounts. Every decision is confirmed by a merchant operator with reason tracking.
              </span>
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}
