/**
 * How train_model.py's machine-readable keys are said out loud.
 *
 * Kept in one module because the landing page and /evidence both render the same comparison, and a
 * feature renamed in one place but not the other would show a merchant two different names for the
 * same thing. Nothing here is data - the numbers always come from data/model_comparison.json.
 */

export const METHOD_LABEL: Record<string, string> = {
  heuristic_corroboration_gated: "Corroboration graph",
  gradient_boosting: "Gradient boosting",
  random_forest: "Random forest",
  logistic_regression: "Logistic regression",
  isolation_forest_unsupervised: "Isolation forest",
}

export const FEATURE_LABEL: Record<string, string> = {
  has_shared_phone_pattern: "Sequential SIM block",
  conf_shared_phone_pattern: "SIM block confidence",
  n_benign_types: "Benign signals",
  n_fraud_types: "Fraud-specific signals",
  avg_confidence: "Edge confidence",
  has_strong_signal: "Strong signal present",
  has_shared_payment: "Shared card",
  conf_shared_payment: "Shared card confidence",
  has_shared_promo: "Funnelled promo",
  conf_shared_promo: "Promo confidence",
  has_shared_address: "Shared address",
  conf_shared_address: "Address confidence",
  n_signal_types: "Distinct signals",
  density: "Group density",
  size: "Group size",
  txn_count: "Transactions in group",
  txn_per_account: "Transactions per account",
  avg_amount_paise: "Average order value",
  amount_std_paise: "Order value spread",
}

/**
 * Features the hand-built corroboration score already weights explicitly.
 *
 * The feature-importance chart highlights these, because the finding is that the trained model's
 * most important features are all in this set: it rediscovered the heuristic rather than finding a
 * signal we had missed. If that ever stops being true, the chart will show it immediately.
 */
export const HAND_WEIGHTED = new Set([
  "has_shared_phone_pattern",
  "conf_shared_phone_pattern",
  "n_fraud_types",
  "n_benign_types",
  "has_strong_signal",
  "has_shared_promo",
  "conf_shared_promo",
  "has_coordinated_timing",
  "conf_coordinated_timing",
])
