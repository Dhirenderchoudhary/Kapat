/**
 * The dashboard-side mirror of cluster_scorer.py's signal classification.
 *
 * Why this exists as a duplicate: the classification is the single most important piece of domain
 * knowledge in the detector, and the merchant needs to SEE it ("this is a family thing" vs "no
 * household does this") to trust or overrule a flag. The detector's own explanation is stored
 * verbatim in audit_log at detection time and rendered as-is on the cluster detail page - that is
 * the authoritative reasoning. This map exists only to colour and label individual evidence rows
 * in the UI, where re-fetching the detector's per-edge classification would mean a schema change
 * (account_links has no signal_class column) for no extra truth.
 *
 * If cluster_scorer.py's BENIGN_EXPLAINABLE / WEAK_FRAUD_SPECIFIC / STRONG_FRAUD_SPECIFIC sets
 * ever change, change them here too. tests/test_signal_taxonomy_parity.py fails if they drift.
 */

export type SignalClass = "benign_explainable" | "weak_fraud_specific" | "strong_fraud_specific"

export const SIGNAL_CLASS: Record<string, SignalClass> = {
  shared_address: "benign_explainable",
  shared_payment: "benign_explainable",
  coordinated_timing: "weak_fraud_specific",
  shared_promo: "strong_fraud_specific",
  shared_phone_pattern: "strong_fraud_specific",
}

export const SIGNAL_LABEL: Record<string, string> = {
  shared_address: "Shared delivery address",
  shared_payment: "Shared payment method",
  coordinated_timing: "Coordinated timing",
  shared_promo: "Same promo code reused",
  shared_phone_pattern: "Sequential phone block",
}

/** What an ordinary household explanation for this signal would be - shown so a merchant can
 *  weigh the flag rather than just receive it. */
export const SIGNAL_INNOCENT_EXPLANATION: Record<string, string> = {
  shared_address: "Families, flatmates, hostels and offices all share one delivery address.",
  shared_payment: "One family card or UPI handle paying for several people is completely ordinary.",
  coordinated_timing: "A real household genuinely does order at the same time as each other.",
  shared_promo:
    "A household has no reason to funnel one promo code through several separate accounts.",
  shared_phone_pattern:
    "Families do not buy consecutive SIM ranges. Bulk disposable-number vendors sell exactly this.",
}

export const SIGNAL_CLASS_LABEL: Record<SignalClass, string> = {
  benign_explainable: "Benign-explainable",
  weak_fraud_specific: "Weak fraud signal",
  strong_fraud_specific: "Strong fraud signal",
}

/**
 * Status styling. Every use pairs the colour with the text label above - colour is never the only
 * carrier of meaning (accessibility, and the merchant is making a money decision on this).
 */
export const SIGNAL_CLASS_STYLE: Record<SignalClass, string> = {
  benign_explainable: "border-transparent bg-muted text-muted-foreground",
  weak_fraud_specific: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  strong_fraud_specific: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
}

export function signalClassOf(signalType: string): SignalClass {
  return SIGNAL_CLASS[signalType] ?? "benign_explainable"
}

/** Risk bands. Ordinal status, not categorical identity - always rendered with its word, not
 *  just its colour. FLAG_THRESHOLD (0.45) is the only band boundary that carries a decision;
 *  the rest are presentational ranking aids. */
export const FLAG_THRESHOLD = 0.45

export type RiskBand = "critical" | "serious" | "watch" | "cleared"

export function riskBand(score: number): RiskBand {
  if (score >= 0.75) return "critical"
  if (score >= FLAG_THRESHOLD) return "serious"
  if (score >= 0.3) return "watch"
  return "cleared"
}

export const RISK_BAND_LABEL: Record<RiskBand, string> = {
  critical: "Critical",
  serious: "Flagged",
  watch: "Below threshold",
  cleared: "Cleared",
}

export const RISK_BAND_STYLE: Record<RiskBand, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  serious: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  watch: "border-transparent bg-muted text-muted-foreground",
  cleared: "border-transparent bg-muted text-muted-foreground",
}
