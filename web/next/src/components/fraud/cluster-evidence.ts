// Design.md §1.2's evidence panel: "a direct translation of the graph into sentences a merchant
// can read in five seconds - don't make them infer it from the graph alone." Groups the raw
// account_links rows (Principle 9: every one already carries a real signal_type and
// confidence) by signal_type and turns each group into one plain sentence.

export type EvidenceRow = {
  accountA: string
  accountB: string
  signalType: string
  confidence: number
}

const SENTENCE_BUILDERS: Record<string, (accountCount: number, avgConfidence: number) => string> = {
  shared_address: (n) => `${n} accounts share the same delivery address.`,
  shared_payment: (n) => `${n} accounts share a payment method fingerprint.`,
  shared_phone_pattern: (n) => `${n} accounts use phone numbers from the same sequential block.`,
  coordinated_timing: (n, conf) =>
    `${n} accounts transacted within a tight, coordinated window of each other (avg. confidence ${(conf * 100).toFixed(0)}%).`,
  shared_promo: (n) =>
    `${n} accounts used the same promo code within a short window of each other.`,
}

export function buildEvidenceSentences(
  evidence: EvidenceRow[],
): { signalType: string; sentence: string; confidence: number }[] {
  const bySignal = new Map<string, { accounts: Set<string>; confidences: number[] }>()
  for (const row of evidence) {
    const entry = bySignal.get(row.signalType) ?? { accounts: new Set(), confidences: [] }
    entry.accounts.add(row.accountA)
    entry.accounts.add(row.accountB)
    entry.confidences.push(row.confidence)
    bySignal.set(row.signalType, entry)
  }

  return Array.from(bySignal.entries())
    .map(([signalType, { accounts, confidences }]) => {
      const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length
      const build = SENTENCE_BUILDERS[signalType]
      const sentence = build
        ? build(accounts.size, avgConfidence)
        : // Never silently drop an unrecognized signal_type into nothing (Principle 9) - fall
          // back to a literal statement rather than pretending it doesn't exist.
          `${accounts.size} accounts are linked by "${signalType}" (avg. confidence ${(avgConfidence * 100).toFixed(0)}%).`
      return { signalType, sentence, confidence: avgConfidence }
    })
    .sort((a, b) => b.confidence - a.confidence)
}
