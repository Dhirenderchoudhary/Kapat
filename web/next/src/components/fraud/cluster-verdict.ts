import {
  FLAG_THRESHOLD,
  SIGNAL_LABEL,
  SIGNAL_PHRASE,
  SIGNAL_WHY_IT_MATTERS,
  signalClassOf,
  type SignalClass,
} from "@/components/fraud/signal-taxonomy"

/**
 * One sentence answering "why is this marked as fraud".
 *
 * A reviewer got to the detail page and could not tell why the group was flagged. The reason it
 * was hard is that the page led with the detector's own audit lines, which are written for the
 * audit trail: they name the taxonomy ("Strong fraud-specific signal: ..."), restate the
 * threshold, and list every signal in class order including the ones that were discounted. All of
 * that has to stay - it is the record - but it is the wrong thing to read first.
 *
 * So this derives the answer from exactly the same values the score came from: what tied the group
 * together, which of those an ordinary household also produces, and where the number landed
 * against the threshold. Nothing here is a second opinion; if the audit trail and this disagree,
 * this is wrong.
 */

export type VerdictDriver = {
  signalType: string
  label: string
  /** The same signal as a noun phrase, for use inside the headline sentence. */
  phrase: string
  why: string
  signalClass: SignalClass
}

export type ClusterVerdict = {
  /** Flagged means: scored at or above the threshold and not capped. */
  outcome: "flagged" | "capped" | "below_threshold"
  /** The whole answer, in one sentence. */
  headline: string
  /** The signals that carried the score, strongest first. */
  drivers: VerdictDriver[]
  /** Signals present but discounted, because a household explains them. */
  discounted: string[]
  /** "0.82, flagged at 0.45" - the arithmetic, kept out of the sentence. */
  scoreLine: string
}

function joinList(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0] as string
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

const CLASS_RANK: Record<SignalClass, number> = {
  strong_fraud_specific: 0,
  weak_fraud_specific: 1,
  benign_explainable: 2,
}

export function buildClusterVerdict({
  accountCount,
  riskScore,
  signalTypes,
  ceilingApplied,
  flagThreshold = FLAG_THRESHOLD,
}: {
  accountCount: number
  riskScore: number
  signalTypes: string[]
  ceilingApplied: boolean
  flagThreshold?: number
}): ClusterVerdict {
  const unique = [...new Set(signalTypes)]
  const drivers = unique
    .filter((t) => signalClassOf(t) !== "benign_explainable")
    .sort((a, b) => CLASS_RANK[signalClassOf(a)] - CLASS_RANK[signalClassOf(b)])
    .map((signalType) => ({
      signalType,
      label: SIGNAL_LABEL[signalType] ?? signalType,
      phrase: SIGNAL_PHRASE[signalType] ?? (SIGNAL_LABEL[signalType] ?? signalType).toLowerCase(),
      why: SIGNAL_WHY_IT_MATTERS[signalType] ?? "This signal is not one of the documented five.",
      signalClass: signalClassOf(signalType),
    }))

  const discounted = unique
    .filter((t) => signalClassOf(t) === "benign_explainable")
    .map((t) => (SIGNAL_LABEL[t] ?? t).toLowerCase())

  const scoreLine = `Scored ${riskScore.toFixed(2)}. The line is ${flagThreshold.toFixed(2)}.`
  const strong = drivers.filter((d) => d.signalClass === "strong_fraud_specific")

  if (ceilingApplied) {
    return {
      outcome: "capped",
      headline: `Not a ring. Every one of these ${accountCount} accounts is tied to the others only by things an ordinary household also shares, so the score was held below the line on purpose.`,
      drivers,
      discounted,
      scoreLine,
    }
  }

  if (riskScore < flagThreshold) {
    return {
      outcome: "below_threshold",
      headline: `Not flagged. ${accountCount} accounts are linked, but not by enough independent signals to clear the line.`,
      drivers,
      discounted,
      scoreLine,
    }
  }

  const lead =
    strong.length > 0
      ? `${accountCount} accounts are linked by ${joinList(strong.map((d) => d.phrase))}. No ordinary household produces that.`
      : drivers.length > 0
        ? `${accountCount} accounts are linked by ${joinList(drivers.map((d) => d.phrase))}, on top of what a household would share.`
        : `${accountCount} accounts scored above the line.`

  return { outcome: "flagged", headline: lead, drivers, discounted, scoreLine }
}
