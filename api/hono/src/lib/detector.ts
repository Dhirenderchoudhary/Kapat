// Pure TypeScript implementation of graph_builder + clustering + cluster_scorer
// Provides a self-contained fallback for cloud and serverless deployments where the Python sidecar is not present.

export interface RawAccount {
  id: string
  delivery_address?: string | null
  payment_method_fingerprint?: string | null
  phone_number?: string | null
  created_at: string
}

export interface RawTransaction {
  id: string
  account_id: string
  amount_paise: number
  promo_code?: string | null
  created_at: string
}

export interface DetectedEvidence {
  signal_type: string
  accounts_involved: [string, string]
  confidence: number
  signal_class: string
}

export interface ScoredCluster {
  member_account_ids: string[]
  score: {
    risk_score: number
    flagged: boolean
    ceiling_applied: boolean
    raw_risk_score: number
    flag_threshold: number
    explanation: string[]
    features: Record<string, unknown>
    chargeback_exposure_paise?: number | null
    evidence: DetectedEvidence[]
  }
}

const ADDRESS_CONFIDENCE = 0.9
const PAYMENT_CONFIDENCE = 0.85
const PHONE_PATTERN_CONFIDENCE = 0.7
const BENIGN_ONLY_CEILING = 0.4
const FLAG_THRESHOLD = 0.45

const SIGNAL_WEIGHT: Record<string, number> = {
  shared_address: 1.0,
  shared_payment: 1.0,
  coordinated_timing: 2.0,
  shared_promo: 3.0,
  shared_phone_pattern: 3.5,
}
const MAX_CORROBORATION_WEIGHT = 10.5

const STRONG_FRAUD_SPECIFIC = new Set(["shared_phone_pattern", "shared_promo"])
const WEAK_FRAUD_SPECIFIC = new Set(["coordinated_timing"])
const BENIGN_EXPLAINABLE = new Set(["shared_address", "shared_payment"])
const FRAUD_SPECIFIC = new Set([...STRONG_FRAUD_SPECIFIC, ...WEAK_FRAUD_SPECIFIC])

interface EdgeSignal {
  signal_type: string
  confidence: number
}

class SignalGraph {
  nodes = new Set<string>()
  edges = new Map<string, Map<string, EdgeSignal[]>>()

  addNode(id: string) {
    this.nodes.add(id)
  }

  addSignal(a: string, b: string, signalType: string, confidence: number) {
    if (a === b) return
    const [u, v] = [a, b].sort()
    if (!this.edges.has(u)) this.edges.set(u, new Map())
    const uEdges = this.edges.get(u)!
    if (!uEdges.has(v)) uEdges.set(v, [])
    const signals = uEdges.get(v)!
    const existing = signals.find((s) => s.signal_type === signalType)
    if (!existing) {
      signals.push({ signal_type: signalType, confidence: Math.round(confidence * 100) / 100 })
    } else if (confidence > existing.confidence) {
      existing.confidence = Math.round(confidence * 100) / 100
    }
  }

  getNeighbors(node: string): string[] {
    const neighbors: string[] = []
    const fromU = this.edges.get(node)
    if (fromU) neighbors.push(...fromU.keys())
    for (const [u, map] of this.edges) {
      if (map.has(node)) neighbors.push(u)
    }
    return neighbors
  }
}

export function detectRingsPure(
  accounts: RawAccount[],
  transactions: RawTransaction[],
  minClusterSize = 2,
): ScoredCluster[] {
  const g = new SignalGraph()
  for (const acc of accounts) g.addNode(acc.id)

  // 1. Shared Address
  const byAddress = new Map<string, string[]>()
  for (const acc of accounts) {
    if (acc.delivery_address) {
      const list = byAddress.get(acc.delivery_address) ?? []
      list.push(acc.id)
      byAddress.set(acc.delivery_address, list)
    }
  }
  for (const ids of byAddress.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        g.addSignal(ids[i]!, ids[j]!, "shared_address", ADDRESS_CONFIDENCE)
      }
    }
  }

  // 2. Shared Payment Fingerprint
  const byPayment = new Map<string, string[]>()
  for (const acc of accounts) {
    if (acc.payment_method_fingerprint) {
      const list = byPayment.get(acc.payment_method_fingerprint) ?? []
      list.push(acc.id)
      byPayment.set(acc.payment_method_fingerprint, list)
    }
  }
  for (const ids of byPayment.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        g.addSignal(ids[i]!, ids[j]!, "shared_payment", PAYMENT_CONFIDENCE)
      }
    }
  }

  // 3. Shared Phone Pattern (sequential block: match on all but last digit)
  const byPhone = new Map<string, string[]>()
  for (const acc of accounts) {
    if (acc.phone_number && acc.phone_number.length > 2) {
      const prefix = acc.phone_number.slice(0, -1)
      const list = byPhone.get(prefix) ?? []
      list.push(acc.id)
      byPhone.set(prefix, list)
    }
  }
  for (const ids of byPhone.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        g.addSignal(ids[i]!, ids[j]!, "shared_phone_pattern", PHONE_PATTERN_CONFIDENCE)
      }
    }
  }

  // 4. Shared Promo within 24h & Coordinated Timing within 10min
  const txSorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const promoPairs = new Map<string, number>()
  const timingPairs = new Map<string, number>()

  for (let i = 0; i < txSorted.length; i++) {
    const tA = txSorted[i]!
    const timeA = new Date(tA.created_at).getTime()
    for (let j = i + 1; j < txSorted.length; j++) {
      const tB = txSorted[j]!
      const timeB = new Date(tB.created_at).getTime()
      const diffMs = timeB - timeA
      if (diffMs > 24 * 60 * 60 * 1000) break
      if (tA.account_id !== tB.account_id) {
        const [u, v] = [tA.account_id, tB.account_id].sort()
        const key = `${u}|${v}`
        if (tA.promo_code && tB.promo_code && tA.promo_code === tB.promo_code) {
          promoPairs.set(key, (promoPairs.get(key) ?? 0) + 1)
        }
        if (diffMs <= 10 * 60 * 1000) {
          timingPairs.set(key, (timingPairs.get(key) ?? 0) + 1)
        }
      }
    }
  }

  for (const [key, count] of promoPairs) {
    if (count >= 2) {
      const [u, v] = key.split("|") as [string, string]
      g.addSignal(u, v, "shared_promo", 0.75)
    }
  }
  for (const [key, count] of timingPairs) {
    if (count >= 2) {
      const [u, v] = key.split("|") as [string, string]
      g.addSignal(u, v, "coordinated_timing", 0.8)
    }
  }

  // 5. Connected Components Clustering
  const visited = new Set<string>()
  const clusters: string[][] = []

  for (const node of g.nodes) {
    if (!visited.has(node)) {
      const queue = [node]
      visited.add(node)
      const component: string[] = []
      while (queue.length > 0) {
        const curr = queue.shift()!
        component.push(curr)
        for (const neighbor of g.getNeighbors(curr)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }
      if (component.length >= minClusterSize) {
        clusters.push(component.sort())
      }
    }
  }

  // 6. Score Each Cluster
  const scoredClusters: ScoredCluster[] = []
  const txByAccount = new Map<string, RawTransaction[]>()
  for (const tx of transactions) {
    const list = txByAccount.get(tx.account_id) ?? []
    list.push(tx)
    txByAccount.set(tx.account_id, list)
  }

  for (const members of clusters) {
    const memberSet = new Set(members)
    const evidence: DetectedEvidence[] = []
    const signalTypesSeen = new Set<string>()
    const confidences: number[] = []
    let internalEdgeCount = 0

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [u, v] = [members[i]!, members[j]!].sort()
        const sigs = g.edges.get(u)?.get(v)
        if (sigs && sigs.length > 0) {
          internalEdgeCount++
          for (const s of sigs) {
            signalTypesSeen.add(s.signal_type)
            confidences.push(s.confidence)
            evidence.push({
              signal_type: s.signal_type,
              accounts_involved: [u, v],
              confidence: s.confidence,
              signal_class: STRONG_FRAUD_SPECIFIC.has(s.signal_type)
                ? "strong_fraud_specific"
                : WEAK_FRAUD_SPECIFIC.has(s.signal_type)
                  ? "weak_fraud_specific"
                  : "benign_explainable",
            })
          }
        }
      }
    }

    let corroborationWeight = 0
    for (const sig of signalTypesSeen) corroborationWeight += SIGNAL_WEIGHT[sig] ?? 1.0
    const corroborationScore = corroborationWeight / MAX_CORROBORATION_WEIGHT

    const size = members.length
    const sizeScore = Math.min(size / 6.0, 1.0)
    const possiblePairs = (size * (size - 1)) / 2
    const densityScore = possiblePairs > 0 ? Math.min(internalEdgeCount / possiblePairs, 1.0) : 0.0
    const avgConfidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.0
    const supportScore = 0.4 * sizeScore + 0.35 * densityScore + 0.25 * avgConfidence

    let rawRisk = 0.7 * corroborationScore + 0.3 * supportScore
    rawRisk = Math.round(Math.min(Math.max(rawRisk, 0.0), 1.0) * 10000) / 10000

    let hasStrong = false
    let fraudSpecificCount = 0
    for (const sig of signalTypesSeen) {
      if (STRONG_FRAUD_SPECIFIC.has(sig)) hasStrong = true
      if (FRAUD_SPECIFIC.has(sig)) fraudSpecificCount++
    }

    const ceilingApplied = !(hasStrong || fraudSpecificCount >= 2)
    const riskScore =
      Math.round((ceilingApplied ? Math.min(rawRisk, BENIGN_ONLY_CEILING) : rawRisk) * 10000) /
      10000
    const flagged = riskScore >= FLAG_THRESHOLD

    let clusterVolume = 0
    for (const m of members) {
      const txs = txByAccount.get(m) ?? []
      for (const t of txs) clusterVolume += t.amount_paise
    }

    scoredClusters.push({
      member_account_ids: members,
      score: {
        risk_score: riskScore,
        flagged,
        ceiling_applied: ceilingApplied,
        raw_risk_score: rawRisk,
        flag_threshold: FLAG_THRESHOLD,
        explanation: [
          `Detected coordinated community of ${members.length} accounts with ${internalEdgeCount} evidence signals.`,
          flagged
            ? `FLAGGED: scored ${riskScore} (>= ${FLAG_THRESHOLD} threshold).`
            : `Capped/unflagged: scored ${riskScore} (< ${FLAG_THRESHOLD} threshold).`,
        ],
        features: {
          size,
          size_score: sizeScore,
          density_score: densityScore,
          avg_confidence: avgConfidence,
          corroboration_score: corroborationScore,
          signal_types_present: Array.from(signalTypesSeen),
        },
        chargeback_exposure_paise: Math.round(clusterVolume * riskScore),
        evidence,
      },
    })
  }

  return scoredClusters
}
