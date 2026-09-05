import {
  RiAlarmWarningLine,
  RiArrowLeftLine,
  RiCustomerService2Line,
  RiFileList2Line,
  RiNodeTree,
  RiShieldCheckLine,
} from "@remixicon/react"
import Link from "next/link"
import { notFound } from "next/navigation"

import { RouteProgress } from "@/components/common/route-progress"
import { ClusterDecide } from "@/components/fraud/cluster-decide"
import { buildEvidenceSentences } from "@/components/fraud/cluster-evidence"
import { ClusterNetworkGraph } from "@/components/fraud/cluster-network-graph"
import { buildClusterVerdict } from "@/components/fraud/cluster-verdict"
import {
  RISK_BAND_LABEL,
  RISK_BAND_STYLE,
  SIGNAL_CLASS_LABEL,
  SIGNAL_CLASS_STYLE,
  SIGNAL_INNOCENT_EXPLANATION,
  SIGNAL_LABEL,
  riskBand,
  signalClassOf,
} from "@/components/fraud/signal-taxonomy"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, unwrap } from "@/lib/api/client"
import { absoluteTime } from "@/lib/time"
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

type DetectionRecord = {
  event?: unknown
  explanation?: unknown
  flagThreshold?: unknown
  ceilingApplied?: unknown
}

/** The detector's own record for this cluster, written at detection time by clusters.ts. */
function detectionRecord(auditLog: { payload: unknown }[]): DetectionRecord | null {
  for (const entry of auditLog) {
    const payload = entry.payload as DetectionRecord
    if (payload?.event === "cluster_detected") return payload
  }
  return null
}

export default async function ClusterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: cluster, error } = await unwrap(apiClient.clusters[":id"].$get({ param: { id } }))

  if (error?.code === "NOT_FOUND") notFound()
  if (error || !cluster) {
    return (
      <PageShell size="lg">
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-6">
          Could not load this ring cluster: {error?.message}
        </div>
      </PageShell>
    )
  }

  const sentences = buildEvidenceSentences(cluster.evidence)
  const detection = detectionRecord(cluster.auditLog)
  const reasoning =
    Array.isArray(detection?.explanation) &&
    detection.explanation.every((line) => typeof line === "string")
      ? (detection.explanation as string[])
      : null
  const band = riskBand(cluster.riskScore)

  // The one-sentence answer, derived from the same evidence rows and the same detector record the
  // rest of the page renders. It leads, because "why is this fraud" is the question someone
  // arrives with; the taxonomy and the audit lines follow for whoever needs to check the working.
  const verdict = buildClusterVerdict({
    accountCount: cluster.accountCount,
    riskScore: cluster.riskScore,
    signalTypes: cluster.evidence.map((e) => e.signalType),
    ceilingApplied: detection?.ceilingApplied === true,
    flagThreshold:
      typeof detection?.flagThreshold === "number" ? detection.flagThreshold : undefined,
  })

  const order = { strong_fraud_specific: 0, weak_fraud_specific: 1, benign_explainable: 2 } as const
  const grouped = [...sentences].sort(
    (a, b) => order[signalClassOf(a.signalType)] - order[signalClassOf(b.signalType)],
  )

  const flagged = verdict.outcome === "flagged"

  return (
    <PageShell size="lg" className="space-y-6">
      <div>
        <Button
          render={<Link href="/clusters" />}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground mb-4 -ml-2 gap-1"
        >
          <RiArrowLeftLine className="size-4" aria-hidden />
          <span>Back to queue</span>
          <RouteProgress />
        </Button>

        <PageHeader
          title={`Case #${cluster.id.slice(0, 10)}`}
          description={`${cluster.accountCount} linked accounts · ${absoluteTime(cluster.createdAt)}`}
          actions={
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-muted-foreground text-xs tracking-wider uppercase">Risk</div>
                <div className="text-foreground text-2xl font-bold tabular-nums">
                  {cluster.riskScore.toFixed(2)}
                </div>
              </div>
              <Badge
                className={cn(
                  "px-3 py-1 text-xs font-semibold tracking-wider uppercase",
                  RISK_BAND_STYLE[band],
                )}
              >
                {RISK_BAND_LABEL[band]}
              </Badge>
            </div>
          }
        />
      </div>

      {/* The verdict. One sentence, then the two or three facts behind it. Everything below this
          block is the working, for whoever wants to check it. */}
      <section
        className={cn(
          "rounded-2xl border p-6 shadow-sm",
          flagged ? "border-destructive/30 bg-destructive/5" : "border-border/80 bg-card/60",
        )}
      >
        <div className="flex items-center gap-2">
          {flagged ? (
            <RiAlarmWarningLine className="text-destructive size-4" aria-hidden />
          ) : (
            <RiShieldCheckLine className="text-success size-4" aria-hidden />
          )}
          <span
            className={cn(
              "text-xs font-semibold tracking-wider uppercase",
              flagged ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {flagged ? "Why this is flagged" : "Why this is not flagged"}
          </span>
        </div>

        <p className="text-foreground mt-2 text-lg leading-snug font-semibold text-balance sm:text-xl">
          {verdict.headline}
        </p>
        <p className="text-muted-foreground mt-1.5 text-sm tabular-nums">{verdict.scoreLine}</p>

        {verdict.drivers.length > 0 && (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {verdict.drivers.map((driver) => (
              <li
                key={driver.signalType}
                className={cn(
                  "bg-background/70 rounded-xl border p-4",
                  driver.signalClass === "strong_fraud_specific"
                    ? "border-destructive/30"
                    : "border-evidence-weak/35",
                )}
              >
                <div className="text-foreground text-sm font-semibold">{driver.label}</div>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{driver.why}</p>
              </li>
            ))}
          </ul>
        )}

        {verdict.discounted.length > 0 && (
          <p className="text-muted-foreground mt-4 text-sm">
            <span className="text-foreground font-medium">Not counted:</span>{" "}
            {verdict.discounted.join(", ")}. A family or flatmates would share these too.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="glass-panel overflow-hidden rounded-xl border p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RiNodeTree className="text-primary size-5" aria-hidden />
                <h2 className="text-foreground text-base font-bold">How they connect</h2>
              </div>
              <span className="text-muted-foreground font-mono text-xs">
                {cluster.accounts.length} accounts · {cluster.evidence.length} links
              </span>
            </div>
            <ClusterNetworkGraph accounts={cluster.accounts} evidence={cluster.evidence} />
          </div>

          {/* The full signal breakdown, both sides of every signal. Second, not first: it is what
              you read when you want to overrule the verdict, not to understand it. */}
          <Card className="glass-panel border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Every signal, both sides</CardTitle>
            </CardHeader>
            <CardContent>
              {grouped.length === 0 ? (
                <p className="text-muted-foreground text-sm">No labelled signals for this group.</p>
              ) : (
                <ul className="space-y-3">
                  {grouped.map((s) => {
                    const cls = signalClassOf(s.signalType)
                    return (
                      <li
                        key={s.signalType}
                        className={cn(
                          "rounded-xl border p-4",
                          cls === "strong_fraud_specific" &&
                            "border-destructive/30 bg-destructive/5",
                          cls === "weak_fraud_specific" &&
                            "border-evidence-weak/35 bg-evidence-weak/5",
                          cls === "benign_explainable" && "border-border/80 bg-card/60",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-foreground text-sm font-bold">
                            {SIGNAL_LABEL[s.signalType] ?? s.signalType}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wider uppercase",
                              SIGNAL_CLASS_STYLE[cls],
                            )}
                          >
                            {SIGNAL_CLASS_LABEL[cls]}
                          </span>
                        </div>
                        <p className="text-foreground mt-2 text-sm leading-relaxed">{s.sentence}</p>
                        <p className="text-muted-foreground mt-2 text-sm">
                          <span className="text-foreground font-medium">Innocent reading:</span>{" "}
                          {SIGNAL_INNOCENT_EXPLANATION[s.signalType] ??
                            "No documented household explanation."}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* The detector's own words, stored verbatim at detection time. Kept, because it is the
              record and a reviewer months from now needs it; collapsed, because it restates the
              taxonomy and the threshold and reading it first is what made this page confusing. */}
          {reasoning && (
            <details className="group border-border/80 bg-card/40 rounded-xl border">
              <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium select-none">
                <RiFileList2Line className="size-4" aria-hidden />
                <span>Detector audit trail, verbatim</span>
                <span className="ml-auto text-xs group-open:hidden">Show</span>
                <span className="ml-auto hidden text-xs group-open:inline">Hide</span>
              </summary>
              <ul className="text-muted-foreground space-y-2 px-4 pb-4 text-sm">
                {reasoning.map((line) => (
                  <li key={line} className="border-border/60 border-l-2 pl-3 leading-relaxed">
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="space-y-6 lg:col-span-5">
          <Card className="glass-panel border-border shadow-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Your decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card/60 rounded-xl border p-3.5">
                  <div className="text-muted-foreground text-xs font-medium">Exposure</div>
                  <div className="text-foreground mt-1 text-xl font-bold tabular-nums">
                    {formatRupees(cluster.chargebackExposurePaise)}
                  </div>
                </div>
                <div className="bg-card/60 rounded-xl border p-3.5">
                  <div className="text-muted-foreground text-xs font-medium">Voice check</div>
                  <div className="text-foreground mt-1 text-sm font-semibold">
                    {VERIFICATION_LABEL[cluster.verificationStatus] ?? cluster.verificationStatus}
                  </div>
                </div>
              </div>

              {cluster.verifications.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                    <RiCustomerService2Line className="text-primary size-4" />
                    <span>Call transcript</span>
                  </div>
                  {cluster.verifications.map((v) => (
                    <div key={v.id} className="bg-muted/40 rounded-xl border p-3.5 text-xs">
                      <div className="text-muted-foreground flex items-center justify-between border-b pb-2">
                        <span className="font-semibold uppercase">{v.languageCode}</span>
                        <span className="text-foreground font-medium">
                          {VERIFICATION_LABEL[v.verificationStatus] ?? v.verificationStatus}
                        </span>
                      </div>
                      {v.transcript && (
                        <p className="text-foreground mt-2 font-mono leading-relaxed italic">
                          &ldquo;{v.transcript}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <ClusterDecide
                clusterId={cluster.id}
                status={cluster.status}
                latestDecision={cluster.decisions[0] ?? null}
              />

              <p className="text-muted-foreground text-xs">
                Whatever you choose is written to the audit log and updates your metrics.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
