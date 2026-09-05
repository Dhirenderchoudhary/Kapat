import {
  RiAlarmWarningLine,
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiFlashlightLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiUserSharedLine,
} from "@remixicon/react"
import Link from "next/link"

import { LinkPending, RouteProgress } from "@/components/common/route-progress"
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
        title="Ring queue"
        description="Coordinated account groups, highest risk first."
        actions={<RunDetection />}
      />

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-4 text-sm font-medium">
          Could not load ring queue: {error.message}
        </div>
      )}

      {!error && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Open cases
                </span>
                <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                  <RiAlarmWarningLine className="size-4.5" />
                </div>
              </div>
              <div className="text-foreground mt-2 text-3xl font-bold tabular-nums">
                {open.length}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">Awaiting your decision</div>
            </div>

            <div className="glass-card-hover border-destructive/30 bg-destructive/5 rounded-xl border p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-destructive text-xs font-semibold tracking-wider uppercase">
                  Critical
                </span>
                <div className="bg-destructive/10 text-destructive flex size-8 items-center justify-center rounded-lg">
                  <RiFlashlightLine className="size-4.5" />
                </div>
              </div>
              <div className="text-destructive mt-2 text-3xl font-bold tabular-nums">
                {critical.length}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">Risk above 0.75</div>
            </div>

            <div className="glass-card-hover rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                  Exposure
                </span>
                <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <RiMoneyDollarCircleLine className="size-4.5" />
                </div>
              </div>
              <div className="text-foreground mt-2 text-3xl font-bold tabular-nums">
                {formatRupees(totalExposure)}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">Across flagged accounts</div>
            </div>
          </div>

          {clusters.length === 0 ? (
            <div className="glass-panel-elevated relative overflow-hidden rounded-2xl border p-12 text-center shadow-xl">
              <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-30" />
              <div className="border-border bg-card text-primary relative mx-auto flex size-20 items-center justify-center rounded-2xl border">
                <RiCheckboxCircleLine className="size-10 text-emerald-500" aria-hidden />
              </div>
              <h3 className="text-foreground relative z-10 mt-5 text-xl font-bold">
                No rings detected
              </h3>
              <p className="text-muted-foreground relative z-10 mx-auto mt-2 max-w-md text-sm">
                Either nothing is loaded yet, or every group here looks like an ordinary household.
              </p>
              <div className="relative z-10 mt-6 flex flex-wrap justify-center gap-3">
                <LoadDemoData />
                <Button render={<Link href="/connect" />} variant="outline" size="sm">
                  Connect Razorpay
                  <RouteProgress />
                </Button>
              </div>
            </div>
          ) : (
            <div className="glass-panel overflow-hidden rounded-xl border shadow-sm">
              <Table>
                <TableHeader>
                  <tr className="bg-muted/40 border-b">
                    <TableHead className="text-foreground font-semibold">Risk</TableHead>
                    <TableHead className="text-foreground font-semibold">Accounts</TableHead>
                    <TableHead className="text-foreground font-semibold">Exposure</TableHead>
                    <TableHead className="text-foreground font-semibold">Voice check</TableHead>
                    <TableHead className="text-foreground font-semibold">Status</TableHead>
                    <TableHead className="text-foreground font-semibold">Detected</TableHead>
                    <TableHead className="text-foreground text-right font-semibold">
                      <span className="sr-only">Open</span>
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
                                "rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wider uppercase",
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
                            <span>{cluster.accountCount}</span>
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
                          {/* The click a reviewer thought had frozen the app. The route now has a
                              loading.tsx for the router to prefetch and paint into, RouteProgress
                              puts a bar at the top of the window the moment the click lands, and
                              LinkPending swaps the arrow for a spinner so the feedback also lands
                              on the control that was actually pressed. */}
                          <Button
                            render={<Link href={`/clusters/${cluster.id}`} />}
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs"
                          >
                            <span>Inspect</span>
                            <LinkPending
                              idle={<RiArrowRightLine className="size-3.5" aria-hidden />}
                              pending={
                                <RiLoader4Line className="size-3.5 animate-spin" aria-hidden />
                              }
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

          <p className="text-muted-foreground text-xs">
            The detector surfaces groups and holds funds. It never blocks an account on its own:
            every decision here is yours, and is recorded with a reason.
          </p>
        </>
      )}
    </PageShell>
  )
}
