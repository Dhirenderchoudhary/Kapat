import { RiErrorWarningLine, RiInformationLine } from "@remixicon/react"

import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, unwrap } from "@/lib/api/client"

export const dynamic = "force-dynamic"

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`
}

const FUNNEL_STATUS_LABEL: Record<string, string> = {
  pending_review: "Awaiting decision",
  pending_verification: "Verification in progress",
  resolved: "Decided",
}

const FUNNEL_ACTION_LABEL: Record<string, string> = {
  freeze: "Frozen",
  block: "Blocked",
  escalate: "Escalated",
  dismiss: "Dismissed",
}

/** Hero number + its word. No chart: these are single headline values, and plotting four
 *  independent percentages against each other would imply a relationship that isn't there. */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground mt-1 text-xs">{hint}</div>}
    </div>
  )
}

export default async function MetricsPage() {
  const { data, error } = await unwrap(apiClient.metrics.$get())

  if (error || !data) {
    return (
      <PageShell size="lg">
        <PageHeader
          title="Detector metrics"
          description="Held-out accuracy and live funnel counts."
        />
        <p className="text-destructive text-sm">Could not load metrics: {error?.message}</p>
      </PageShell>
    )
  }

  const { detector, detectorNote, verifier, verifierNote, funnel } = data

  return (
    <PageShell size="lg">
      <PageHeader
        title="Detector metrics"
        description="Measured once on a split the detector never saw, not recomputed here."
      />

      <div className="space-y-6">
        {detector ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Ring detector - held-out test split</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-6 sm:grid-cols-3">
                <Metric
                  label="Recall on true rings"
                  value={pct(detector.recall_true_rings)}
                  hint={`${detector.n_true_rings} rings in the test split`}
                />
                <Metric
                  label="Precision on flagged clusters"
                  value={pct(detector.precision_predicted_clusters)}
                  hint={
                    detector.n_flagged_clusters !== undefined
                      ? `${detector.n_flagged_clusters} of ${detector.n_predicted_clusters} groups were flagged`
                      : undefined
                  }
                />
                <Metric
                  label="Households wrongly flagged"
                  value={`${detector.n_lookalikes_wrongly_flagged ?? detector.n_lookalikes_wrongly_flagged_high_confidence} / ${detector.n_lookalikes}`}
                  hint="The false-positive cost that matters"
                />
              </div>

              {detector.precision_without_threshold !== null &&
                detector.precision_without_threshold !== undefined && (
                  <div className="bg-muted/50 rounded-md border p-3 text-sm">
                    <span className="font-medium">Where this came from: </span>
                    with no decision threshold, surfacing every connected group it found, which is
                    what the first version of this detector did, precision on the same split is{" "}
                    <span className="font-semibold tabular-nums">
                      {pct(detector.precision_without_threshold)}
                    </span>
                    . The gain is from scoring corroboration instead of connection density, plus a
                    threshold of {detector.flag_threshold} chosen on the training split only.
                  </div>
                )}

              {detector.validity_caveat && (
                <p className="text-muted-foreground flex items-start gap-2 text-xs">
                  <RiErrorWarningLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{detector.validity_caveat}</span>
                </p>
              )}

              <p className="text-muted-foreground flex items-start gap-2 text-xs">
                <RiInformationLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{detector.cost_model_note}</span>
              </p>

              <p className="text-muted-foreground text-xs">
                From {detector.test_data_file}, generated{" "}
                {new Date(detector.generated_at).toLocaleString("en-IN")}.
                {detector.threshold_selected_on && (
                  <> Threshold selected on {detector.threshold_selected_on}.</>
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Ring detector - held-out test split</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">{detectorNote}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Voice verifier - held-out response set</CardTitle>
          </CardHeader>
          <CardContent>
            {verifier ? (
              <div className="space-y-4">
                <Metric
                  label="Accuracy"
                  value={pct(verifier.accuracy)}
                  hint={`${verifier.correct} of ${verifier.total_entries} responses parsed correctly`}
                />
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {Object.entries(verifier.accuracy_by_outcome).map(([outcome, acc]) => (
                    <div key={outcome} className="flex justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">{outcome}</span>
                      <span className="tabular-nums">{pct(acc)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground flex items-start gap-2 text-xs">
                  <RiErrorWarningLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    100% on a self-authored synthetic set is not the same claim as accuracy on real
                    calls. A live Sarvam AI validation pass with a fluent Hindi/Marathi speaker is
                    still outstanding.
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{verifierNote}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Funnel - live from Postgres</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-6 sm:grid-cols-3">
              <Metric label="Clusters flagged" value={String(funnel.clustersFlagged)} />
              <Metric label="Clusters verified" value={String(funnel.clustersVerified)} />
              <Metric label="Audit log entries" value={String(funnel.auditLogEntries)} />
            </div>

            {Object.keys(funnel.clustersByStatus).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(funnel.clustersByStatus).map(([status, n]) => (
                  <span key={status} className="rounded-full border px-2.5 py-1 text-xs">
                    {FUNNEL_STATUS_LABEL[status] ?? status}:{" "}
                    <span className="tabular-nums">{n}</span>
                  </span>
                ))}
              </div>
            )}

            {Object.keys(funnel.decisionsByAction).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(funnel.decisionsByAction).map(([action, n]) => (
                  <span key={action} className="bg-muted rounded-full px-2.5 py-1 text-xs">
                    {FUNNEL_ACTION_LABEL[action] ?? action}:{" "}
                    <span className="tabular-nums">{n}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
