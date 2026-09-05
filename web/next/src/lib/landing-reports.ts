import "server-only"
import detectorMetrics from "@/reports/detector_metrics.json"
import holdVerification from "@/reports/hold_verification_report.json"
import modelComparison from "@/reports/model_comparison.json"
import thresholdSelection from "@/reports/threshold_selection.json"

// These are the same committed evaluation reports bundled by the evidence API.
// Only server components import them; the browser receives the chart projections.
export const landingReports = {
  detectorMetrics,
  holdVerification,
  modelComparison,
  thresholdSelection,
}
