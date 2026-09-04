import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { auditLog, clusters, db, merchantDecisions, verifications } from "@packages/db"
import { count, countDistinct } from "drizzle-orm"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
// Architecture.md §6: GET /api/metrics - "Precision/recall, false-positive cost, funnel numbers".
// Design.md §1.4: "the screen the demo lingers on." Deliberately unauthenticated, matching
// clusters.ts (Design.md §4: no merchant auth/login flows in this build).
//
// Two very different kinds of number live in this one response, and this file is careful never
// to blur them (Principle 5 - no fabricated confidence):
//
//   - detector/verifier metrics are OFFLINE, held-out evaluation numbers, computed by
//     evaluate.py and evaluate_verifier.py against data neither pipeline was tuned on. This
//     route does not recompute them (that would mean shipping networkx/scoring logic into the
//     TS API, wrongly, and re-running a research script on every dashboard page load) - it reads
//     the JSON files those scripts already wrote. If a file isn't there yet (fresh checkout,
//     scripts never run), the corresponding field is `null` with an honest `note`, never a
//     fabricated 0 or 1.
//   - funnel counts are LIVE, queried straight from Postgres on every request - how many
//     clusters actually got flagged, verified, and decided in this environment right now.

// import.meta.dir points at wherever THIS module is actually executing from, and that depth
// differs by run mode: 4 levels deep in dev (api/hono/src/routers, running straight from
// source) but only 3 in a built Docker image (api/hono/bundle, after tsdown + bun build flatten
// everything into bundle/index.mjs) - a fixed number of "../" segments is wrong for one of the
// two. METRICS_DATA_DIR sidesteps that entirely: unset in dev (falls back to the source-relative
// default, which is correct there), and set explicitly to /app/data by the Docker runner stage
// + docker-compose's read-only bind mount of ./data, so evaluate.py/evaluate_verifier.py output
// is visible at runtime without baking data/ into the image or rebuilding on every re-run.
import detectorMetricsJson from "../../../../data/detector_metrics.json" with { type: "json" }
import modelComparisonJson from "../../../../data/model_comparison.json" with { type: "json" }
import verifierMetricsJson from "../../../../data/verifier_metrics.json" with { type: "json" }

const DATA_DIR = process.env.METRICS_DATA_DIR ?? resolve(import.meta.dir, "../../../../data")
const DETECTOR_METRICS_PATH = resolve(DATA_DIR, "detector_metrics.json")
const VERIFIER_METRICS_PATH = resolve(DATA_DIR, "verifier_metrics.json")
const MODEL_COMPARISON_PATH = resolve(DATA_DIR, "model_comparison.json")

function readJsonFileIfPresent(path: string, bundled: unknown): unknown | null {
  if (bundled) return bundled
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

const detectorMetricsSchema = z.object({
  generated_at: z.string(),
  test_data_file: z.string(),
  n_true_rings: z.number(),
  n_lookalikes: z.number(),
  n_predicted_clusters: z.number(),
  // Phase 10. Optional rather than required so a detector_metrics.json
  // written by the pre-threshold evaluate.py still parses instead of collapsing the whole card to
  // "no metrics found" - an older file is stale, not corrupt, and the dashboard should say so
  // rather than pretend nothing was ever measured.
  n_flagged_clusters: z.number().optional(),
  flag_threshold: z.number().optional(),
  threshold_selected_on: z.string().optional(),
  precision_without_threshold: z.number().nullable().optional(),
  n_lookalikes_wrongly_flagged: z.number().optional(),
  validity_caveat: z.string().optional(),
  recall_true_rings: z.number().nullable(),
  precision_predicted_clusters: z.number().nullable(),
  n_lookalikes_wrongly_flagged_high_confidence: z.number(),
  high_confidence_threshold: z.number(),
  cost_model_note: z.string(),
})

const verifierMetricsSchema = z.object({
  total_entries: z.number(),
  correct: z.number(),
  accuracy: z.number(),
  accuracy_by_outcome: z.record(z.string(), z.number()),
  accuracy_by_language: z.record(z.string(), z.number()),
  counts_by_outcome: z.record(z.string(), z.object({ correct: z.number(), total: z.number() })),
  counts_by_language: z.record(z.string(), z.object({ correct: z.number(), total: z.number() })),
  misclassified: z.array(z.unknown()),
})

// train_model.py's output. Same read-the-file-the-script-wrote rule as the two above: this API
// does not train anything, and there is no scikit-learn anywhere in the TS service. The landing
// page and /evidence quote these numbers, so they must come from the committed run report rather
// than being typed into a marketing page where they would quietly go stale.
//
// The schema is deliberately narrow - only the fields a page actually renders - so adding a new
// model or a new field to train_model.py cannot break the dashboard.
const methodResultSchema = z.object({
  test_average_precision: z.number(),
  cv_average_precision_mean: z.number().optional(),
  test_roc_auc: z.number().nullable().optional(),
  operating_threshold: z.number().optional(),
  test_at_operating_threshold: z
    .object({
      precision: z.number(),
      recall: z.number(),
      f1: z.number(),
      false_positives: z.number(),
      false_negatives: z.number(),
      expected_cost: z.number(),
    })
    .partial()
    .optional(),
  note: z.string().optional(),
})

const splitSchema = z.object({
  dataset: z
    .object({
      train_clusters: z.number(),
      test_clusters: z.number(),
      train_positives: z.number(),
      test_positives: z.number(),
      n_features: z.number(),
    })
    .partial(),
  results: z.record(z.string(), methodResultSchema),
  ranking_by_expected_cost: z.array(z.object({ method: z.string(), expected_cost: z.number() })),
  per_difficulty: z
    .record(
      z.string(),
      z.object({ n: z.number(), model_correct: z.number(), heuristic_correct: z.number() }),
    )
    .optional(),
  feature_importance: z.array(z.object({ feature: z.string(), importance: z.number() })),
})

// train_model.py's output. Same read-the-file-the-script-wrote rule as the two above: this API
// trains nothing and there is no scikit-learn anywhere in the TS service.
//
// The report carries TWO splits on purpose. "easy" is the original generator, where every method
// scores a perfect 1.000 including one trained with no labels at all - kept as evidence that the
// number measures the dataset rather than the detector. "hard" is the graded generator where the
// classes genuinely overlap, and it is the one the dashboard quotes.
const modelComparisonSchema = z.object({
  generated_at: z.string(),
  feature_names: z.array(z.string()),
  cost_model: z
    .object({
      false_positive_cost: z.number(),
      false_negative_cost: z.number(),
      units: z.string(),
      why_not_rupees: z.string(),
    })
    .partial(),
  splits: z.record(z.string(), splitSchema),
  adversarial_evaluation: z.object({
    summary: z.record(
      z.string(),
      z.object({
        correct: z.number(),
        total: z.number(),
        accuracy: z.number(),
        failures: z.array(
          z.object({
            case: z.string(),
            expected: z.string(),
            score: z.number(),
            kind: z.string(),
          }),
        ),
      }),
    ),
  }),
  headline: z.record(z.string(), z.unknown()).optional(),
})

const funnelSchema = z.object({
  clustersFlagged: z.number(),
  clustersVerified: z.number(),
  clustersByStatus: z.record(z.string(), z.number()),
  decisionsByAction: z.record(z.string(), z.number()),
  auditLogEntries: z.number(),
})

const metricsResponseSchema = z.object({
  detector: detectorMetricsSchema.nullable(),
  detectorNote: z.string().nullable(),
  verifier: verifierMetricsSchema.nullable(),
  verifierNote: z.string().nullable(),
  models: modelComparisonSchema.nullable(),
  modelsNote: z.string().nullable(),
  funnel: funnelSchema,
})

async function computeFunnel(): Promise<z.infer<typeof funnelSchema>> {
  const [[totalRow], [verifiedRow], statusRows, decisionRows, [auditRow]] = await Promise.all([
    db.select({ n: count() }).from(clusters),
    db.select({ n: countDistinct(verifications.clusterId) }).from(verifications),
    db.select({ status: clusters.status, n: count() }).from(clusters).groupBy(clusters.status),
    db
      .select({ action: merchantDecisions.action, n: count() })
      .from(merchantDecisions)
      .groupBy(merchantDecisions.action),
    db.select({ n: count() }).from(auditLog),
  ])

  const clustersByStatus: Record<string, number> = {}
  for (const row of statusRows) clustersByStatus[row.status] = row.n

  const decisionsByAction: Record<string, number> = {}
  for (const row of decisionRows) decisionsByAction[row.action] = row.n

  return {
    clustersFlagged: totalRow?.n ?? 0,
    clustersVerified: verifiedRow?.n ?? 0,
    clustersByStatus,
    decisionsByAction,
    auditLogEntries: auditRow?.n ?? 0,
  }
}

export const metricsRouter = new Hono().get(
  "/",
  describeRoute({
    tags: ["Metrics"],
    description:
      "Detector precision/recall, verifier accuracy, and the trained-model comparison (all offline, held-out evaluation - read from evaluate.py/evaluate_verifier.py/train_model.py's last run, never recomputed here) plus live funnel counts from Postgres (Design.md §1.4).",
    ...({
      "x-codeSamples": [
        {
          lang: "typescript",
          label: "hono/client",
          source: `import { apiClient, unwrap } from "@/lib/api/client"

const { data, error } = await unwrap(apiClient.metrics.$get())`,
        },
      ],
    } as object),
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: resolver(z.object({ data: metricsResponseSchema })),
          },
        },
      },
    },
  }),
  async (c) => {
    const detectorRaw = readJsonFileIfPresent(DETECTOR_METRICS_PATH, detectorMetricsJson)
    const verifierRaw = readJsonFileIfPresent(VERIFIER_METRICS_PATH, verifierMetricsJson)
    const modelsRaw = readJsonFileIfPresent(MODEL_COMPARISON_PATH, modelComparisonJson)
    const detectorParsed = detectorRaw ? detectorMetricsSchema.safeParse(detectorRaw) : null
    const verifierParsed = verifierRaw ? verifierMetricsSchema.safeParse(verifierRaw) : null
    const modelsParsed = modelsRaw ? modelComparisonSchema.safeParse(modelsRaw) : null

    const funnel = await computeFunnel()

    const data = {
      detector: detectorParsed?.success ? detectorParsed.data : null,
      detectorNote: detectorParsed?.success
        ? null
        : "No held-out detector metrics found. Run `python3 services/detector-service/evaluate.py` to generate data/detector_metrics.json (Principle 5: no fabricated recall/precision).",
      verifier: verifierParsed?.success ? verifierParsed.data : null,
      verifierNote: verifierParsed?.success
        ? null
        : "No verifier accuracy metrics found. Run `python3 services/verifier-service/evaluate_verifier.py` to generate data/verifier_metrics.json.",
      models: modelsParsed?.success ? modelsParsed.data : null,
      modelsNote: modelsParsed?.success
        ? null
        : "No model comparison found. Run `python3 services/detector-service/train_model.py` (needs services/detector-service/requirements-analysis.txt) to generate data/model_comparison.json.",
      funnel,
    }
    return c.json({ data })
  },
)
