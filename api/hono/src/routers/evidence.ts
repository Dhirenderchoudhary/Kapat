import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
// GET /api/evidence - everything this project has measured about itself, in one call.
//
// The point is not decoration. A merchant evaluating a fraud detector they did not build has no way
// to know whether it works, and "trust us" is not an answer. These are the four artefacts the
// repository actually produces, including the one that lists the cases where the detector fails.
// Serving the failures next to the successes is the entire argument: a detector whose limits you
// cannot see is a detector you cannot safely act on.
//
// Files are read per request, not cached. They are small, and a cached number that has drifted from
// the file on disk is worse than a slow read.

import batchRunJson from "../../../../data/batch_run_report.json" with { type: "json" }
import detectorMetricsJson from "../../../../data/detector_metrics.json" with { type: "json" }
import holdVerificationJson from "../../../../data/hold_verification_report.json" with { type: "json" }
import stressTestJson from "../../../../data/stress_test_report.json" with { type: "json" }
import thresholdSelectionJson from "../../../../data/threshold_selection.json" with { type: "json" }

const DATA_DIR = process.env.METRICS_DATA_DIR ?? resolve(import.meta.dir, "../../../../data")

const BUNDLED_FILES: Record<string, unknown> = {
  detectorMetrics: detectorMetricsJson,
  stressTest: stressTestJson,
  holdVerification: holdVerificationJson,
  thresholdSelection: thresholdSelectionJson,
  batchRun: batchRunJson,
}

const FILES = {
  detectorMetrics: "detector_metrics.json",
  stressTest: "stress_test_report.json",
  holdVerification: "hold_verification_report.json",
  thresholdSelection: "threshold_selection.json",
  batchRun: "batch_run_report.json",
} as const

function readIfPresent(key: string, file: string): unknown | null {
  if (BUNDLED_FILES[key]) return BUNDLED_FILES[key]
  try {
    return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8"))
  } catch {
    return null
  }
}

export const evidenceRouter = new Hono().get(
  "/",
  describeRoute({
    tags: ["Metrics"],
    description:
      "Every measurement this project has made about its own detector: held-out precision/recall, the adversarial stress test including the cases it fails, the 100-payment hold verification, the training-split threshold selection, and the full-dataset batch run. Read from data/ on each request.",
    responses: { 200: { description: "OK" } },
  }),
  (c) => {
    const data = Object.fromEntries(
      Object.entries(FILES).map(([key, file]) => [key, readIfPresent(key, file)]),
    ) as Record<keyof typeof FILES, unknown>

    const missing = Object.entries(FILES)
      .filter(([key]) => data[key as keyof typeof FILES] === null)
      .map(([key, file]) => ({ key, file }))

    return c.json({
      data: {
        ...data,
        missing,
        dataDir: DATA_DIR,
        howToRegenerate: {
          detectorMetrics: "python3 services/detector-service/evaluate.py",
          stressTest: "python3 services/detector-service/stress_test.py",
          holdVerification: "python3 services/detector-service/verify_holds.py --n 100",
          thresholdSelection: "python3 services/detector-service/select_threshold.py",
          batchRun: "python3 services/detector-service/run_batch.py",
        },
      },
    })
  },
)
