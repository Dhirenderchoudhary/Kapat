import { RiCheckboxCircleLine } from "@remixicon/react"
import Link from "next/link"

import { RouteProgress } from "@/components/common/route-progress"
import { ClusterQueue } from "@/components/fraud/cluster-queue"
import { LoadDemoData } from "@/components/fraud/load-demo-data"
import { RunDetection } from "@/components/fraud/run-detection"
import { riskBand } from "@/components/fraud/signal-taxonomy"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"

export const dynamic = "force-dynamic"

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
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
          {/* Three counts of one kind, divided by rules rather than boxed in cards.
              They were three tinted panels, each with its own border colour, its own icon in its
              own tinted square and an ALL-CAPS label - three different colour treatments for three
              numbers that mean the same sort of thing, and one of them spent a red on a total that
              carries no alarm. The landing hero already made this call and wrote down why: a row of
              measurements reads as one measurement taken three ways, and boxes read as three
              separate things. Colour is left for the evidence, which is what it means here. */}
          {clusters.length > 0 && (
            <dl className="divide-border grid grid-cols-1 gap-px sm:grid-cols-3 sm:divide-x">
              <div className="sm:pr-6">
                <dd className="text-foreground font-mono text-3xl tabular-nums">{open.length}</dd>
                <dt className="text-muted-foreground mt-1 text-sm">
                  Groups awaiting your decision
                </dt>
              </div>
              <div className="pt-4 sm:px-6 sm:pt-0">
                <dd className="text-foreground font-mono text-3xl tabular-nums">
                  {critical.length}
                </dd>
                <dt className="text-muted-foreground mt-1 text-sm">Scored above 0.75</dt>
              </div>
              <div className="pt-4 sm:pt-0 sm:pl-6">
                <dd className="text-foreground font-mono text-3xl tabular-nums">
                  {formatRupees(totalExposure)}
                </dd>
                <dt className="text-muted-foreground mt-1 text-sm">
                  Chargeback exposure held across them
                </dt>
              </div>
            </dl>
          )}

          {clusters.length === 0 ? (
            <div className="glass-panel-elevated relative overflow-hidden rounded-2xl border p-12 text-center shadow-xl">
              <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-30" />
              <div className="border-border bg-card text-primary relative mx-auto flex size-20 items-center justify-center rounded-2xl border">
                <RiCheckboxCircleLine className="text-primary size-10" aria-hidden />
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
            <ClusterQueue rows={clusters} />
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
