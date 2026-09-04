// Pure TypeScript fallback for graph_builder + clustering + cluster_scorer, for cloud and
// serverless deployments where the Python sidecar is not present.
//
// READ THIS BEFORE QUOTING ANY NUMBER AGAINST THIS FILE.
//
// This is NOT a port of the Python detector, and it must not be described as one. It reproduces
// the signal derivation and the corroboration-gated scorer faithfully, but it groups accounts with
// CONNECTED COMPONENTS where services/detector-service/clustering.py runs LOUVAIN community
// detection. Those are different algorithms with different failure modes: connected components
// merges everything transitively linked, so a single chain of shared addresses can fuse several
// distinct groups into one blob that Louvain would have separated. On the same input the two
// engines can and do return different clusters.
//
// The consequence that matters: every measured number this project publishes (data/*.json, the
// README tables, /metrics, /evidence) was produced by the PYTHON path. None of them describe this
// file. A run that fell back here is a run with no published precision or recall behind it, which
// is why routers/clusters.ts records `engine`, `clusteringMethod` and `fallbackReason` on the
// response and in the audit log rather than letting a fallback pass for the real thing.
//
// Bringing the two into parity means implementing Louvain here and testing both against the same
// fixtures. Until that happens, treat this as a degraded mode that keeps the product working, not
// as the detector the metrics are about.

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

// Mirrors graph_builder.py's constants of the same names. Kept in the same order and the same
// units so a reader can diff the two files by eye.
const TIMING_WINDOW_MS = 10 * 60 * 1000
const PROMO_WINDOW_MS = 24 * 60 * 60 * 1000
const TIMING_CONFIDENCE_FLOOR = 0.5
const TIMING_CONFIDENCE_CEILING = 0.95
const PROMO_CONFIDENCE_FLOOR = 0.4
const PROMO_CONFIDENCE_CEILING = 0.8

// A single near-simultaneous transaction between two unrelated accounts is ordinary noise at real
// volumes; a pair that keeps co-occurring is a pattern. Same floor, same reason, as graph_builder.py.
const MIN_CORROBORATING_OCCASIONS = 2

// Above this many accounts sharing one address, card fingerprint or phone prefix, the shared value
// stops being evidence about any particular pair: it is a hostel, an office, a mail drop or a
// checkout placeholder. Mirrors graph_builder.MAX_SHARED_KEY_GROUP, which carries the full
// reasoning and the cost argument (the group is a complete graph, so 500 accounts at one address
// would be 124,750 edges, rebuilt on every webhook).
const MAX_SHARED_KEY_GROUP = 50

/** Link every pair inside each group that shares a key, skipping groups too large to be evidence. */
function addExactMatchSignals(
  g: SignalGraph,
  groups: Map<string, string[]>,
  signalType: string,
  confidence: number,
) {
  for (const ids of groups.values()) {
    if (ids.length < 2 || ids.length > MAX_SHARED_KEY_GROUP) continue
    const sorted = [...ids].sort()
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        g.addSignal(sorted[i]!, sorted[j]!, signalType, confidence)
      }
    }
  }
}

/** Fold an address to a comparison key. Mirrors graph_builder.normalize_address, which carries the
 *  full reasoning: `shared_address` is the highest-confidence signal in the graph and is derived by
 *  string equality, so on real checkout data three people typing one doorstep three ways would read
 *  as three unrelated accounts. Conservative on purpose: case, whitespace and separator punctuation
 *  are noise, but digits are never touched and components are never reordered, so two flats in one
 *  building stay two addresses. */
function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const folded = [...value.toLowerCase()]
    .map((ch) => (",./#-".includes(ch) ? " " : ch))
    .filter((ch) => /[a-z0-9\s]/.test(ch))
    .join("")
  const collapsed = folded.split(/\s+/).filter(Boolean).join(" ")
  return collapsed || null
}

/** How many separate bursts these observation times represent: consecutive observations more than
 *  one window apart start a new occasion. Mirrors graph_builder._count_occasions, and exists for
 *  the same reason - counting matching transaction PAIRS does not measure repetition. Two accounts
 *  placing three orders each during one shared session produce up to nine pairs from a single
 *  co-occurrence, which is ordinary household behaviour rather than coordination. */
function countOccasions(times: number[], windowMs: number): number {
  if (times.length === 0) return 0
  const ordered = [...times].sort((a, b) => a - b)
  let occasions = 1
  let previous = ordered[0]!
  for (const current of ordered.slice(1)) {
    if (current - previous > windowMs) occasions += 1
    previous = current
  }
  return occasions
}

/** Closer together inside the window scores higher, scaled into that signal's own band. Matches
 *  graph_builder.py's `closeness` calculation, including its 2-decimal rounding. */
function decayedConfidence(
  deltaMs: number,
  windowMs: number,
  floor: number,
  ceiling: number,
): number {
  const closeness = windowMs ? 1 - deltaMs / windowMs : 1
  return Math.round((floor + (ceiling - floor) * closeness) * 100) / 100
}

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

// ---------------------------------------------------------------------------------------------
// Louvain community detection
// ---------------------------------------------------------------------------------------------
// A port of networkx.algorithms.community.louvain_communities, which is what
// services/detector-service/clustering.py calls. This file used to group with connected
// components, a materially different algorithm: it merges everything transitively linked, so one
// chain of shared addresses fuses groups that Louvain keeps apart. Two engines that disagree about
// which accounts form a group disagree about everything downstream of it.
//
// The one deliberate difference from networkx: it shuffles the node visit order with its seeded
// RNG (clustering.py passes seed=42), and reproducing CPython's Mersenne Twister here would be a
// lot of intricate code in a fraud detector's fallback path, carrying its own silent-divergence
// risk. This visits nodes in sorted order instead. That changes the order local moves are
// attempted, not the algorithm, and Louvain only depends on that order where moves are tied.
//
// Measured rather than assumed. Communities identical to the Python service, per dataset:
//
//   detector_train.json    27 / 27    100%
//   detector_test.json     12 / 12    100%     <- the split every published metric comes from
//   hard_test.json        131 / 131   100%
//   hard_train.json       200 / 209    95.2%   <- the densest graph in the repo, 9 differ
//
// For comparison, the connected-components grouping this replaced agreed on 78.5% of hard_train
// and, worse than the count suggests, returned one blob of 966 accounts as a single "cluster"
// because a chain of shared addresses links them transitively. That is not a near-miss, it is a
// different answer to the question.
//
// The residual 9 on hard_train are tied local moves resolved in a different order. That is the
// honest limit of this parity, and it is why the API still reports `engine` and `clusteringMethod`
// on every run rather than treating the two paths as interchangeable.

interface WeightedGraph {
  /** Node ids at this level. Aggregated levels use community indices as ids. */
  nodes: string[]
  /** Symmetric adjacency, including the self-loops aggregation creates. */
  adj: Map<string, Map<string, number>>
  /** Original account ids behind each node, so an aggregated level can still report members. */
  members: Map<string, Set<string>>
}

/** Weighted degree, counting a self-loop twice to match networkx's convention. The modularity
 *  terms below are derived from that convention and are wrong without it. */
function weightedDegree(graph: WeightedGraph, node: string): number {
  let degree = 0
  for (const [neighbor, weight] of graph.adj.get(node) ?? []) {
    degree += neighbor === node ? weight * 2 : weight
  }
  return degree
}

function totalEdgeWeight(graph: WeightedGraph): number {
  let sum = 0
  for (const node of graph.nodes) sum += weightedDegree(graph, node)
  return sum / 2
}

function modularity(graph: WeightedGraph, communities: Set<string>[], resolution: number): number {
  const degrees = new Map(graph.nodes.map((n) => [n, weightedDegree(graph, n)]))
  let degreeSum = 0
  for (const degree of degrees.values()) degreeSum += degree
  if (degreeSum === 0) return 0
  const m = degreeSum / 2
  const norm = 1 / (degreeSum * degreeSum)

  let total = 0
  for (const community of communities) {
    let internal = 0
    let communityDegree = 0
    for (const u of community) {
      communityDegree += degrees.get(u) ?? 0
      for (const [v, weight] of graph.adj.get(u) ?? []) {
        // Each internal edge once: self-loops directly, ordinary edges from one side only.
        if (v === u) internal += weight
        else if (community.has(v) && u < v) internal += weight
      }
    }
    total += internal / m - resolution * communityDegree * communityDegree * norm
  }
  return total
}

/** One pass of local moving. Mirrors networkx's `_one_level`, including its modularity-gain
 *  formulation and its strict `>` comparison, so a tied move is not taken. */
function oneLevel(
  graph: WeightedGraph,
  m: number,
  partition: Set<string>[],
  resolution: number,
): { partition: Set<string>[]; innerPartition: Set<string>[]; improved: boolean } {
  const order = [...graph.nodes].sort()
  const node2com = new Map<string, number>()
  const innerPartition: Set<string>[] = []
  graph.nodes.forEach((node, index) => {
    node2com.set(node, index)
    innerPartition.push(new Set([node]))
  })

  const degrees = new Map(graph.nodes.map((n) => [n, weightedDegree(graph, n)]))
  const stot = graph.nodes.map((n) => degrees.get(n) ?? 0)

  let improved = false
  let moves = 1
  while (moves > 0) {
    moves = 0
    for (const u of order) {
      const currentCom = node2com.get(u)!
      const degree = degrees.get(u) ?? 0

      // Weight from u into each neighbouring community. Self-loops are excluded: they are internal
      // to u and travel with it, so they argue neither for nor against a move.
      const weightToCom = new Map<number, number>()
      for (const [v, weight] of graph.adj.get(u) ?? []) {
        if (v === u) continue
        const com = node2com.get(v)!
        weightToCom.set(com, (weightToCom.get(com) ?? 0) + weight)
      }

      stot[currentCom]! -= degree
      const removeCost =
        -(weightToCom.get(currentCom) ?? 0) / m +
        (resolution * (stot[currentCom]! * degree)) / (2 * m * m)

      let bestGain = 0
      let bestCom = currentCom
      for (const [com, weight] of weightToCom) {
        const gain = removeCost + weight / m - (resolution * (stot[com]! * degree)) / (2 * m * m)
        if (gain > bestGain) {
          bestGain = gain
          bestCom = com
        }
      }
      stot[bestCom]! += degree

      if (bestCom !== currentCom) {
        const moved = graph.members.get(u) ?? new Set([u])
        for (const original of moved) partition[currentCom]!.delete(original)
        innerPartition[currentCom]!.delete(u)
        for (const original of moved) partition[bestCom]!.add(original)
        innerPartition[bestCom]!.add(u)
        node2com.set(u, bestCom)
        improved = true
        moves += 1
      }
    }
  }

  return {
    partition: partition.filter((community) => community.size > 0),
    innerPartition: innerPartition.filter((community) => community.size > 0),
    improved,
  }
}

/** Collapse each community into one node, preserving total edge weight as self-loops. */
function aggregate(graph: WeightedGraph, communities: Set<string>[]): WeightedGraph {
  const node2com = new Map<string, string>()
  const members = new Map<string, Set<string>>()
  communities.forEach((community, index) => {
    const id = String(index)
    const originals = new Set<string>()
    for (const node of community) {
      node2com.set(node, id)
      for (const original of graph.members.get(node) ?? [node]) originals.add(original)
    }
    members.set(id, originals)
  })

  const nodes = communities.map((_community, index) => String(index))
  const adj = new Map<string, Map<string, number>>(nodes.map((n) => [n, new Map<string, number>()]))
  const add = (a: string, b: string, weight: number) => {
    adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + weight)
  }
  for (const u of [...graph.nodes].sort()) {
    for (const [v, weight] of graph.adj.get(u) ?? []) {
      if (v < u) continue // each undirected edge once; self-loops fall through
      const a = node2com.get(u)!
      const b = node2com.get(v)!
      add(a, b, weight)
      if (a !== b) add(b, a, weight)
    }
  }
  return { nodes, adj, members }
}

/** Communities of at least `minSize` accounts, by Louvain modularity optimisation. */
function louvainCommunities(graph: WeightedGraph, minSize: number, resolution = 1): string[][] {
  if (graph.nodes.length === 0) return []
  const m = totalEdgeWeight(graph)
  if (m === 0) return []

  const threshold = 1e-7
  let working = graph
  const partition: Set<string>[] = [...graph.nodes]
    .sort()
    .map((node) => new Set(graph.members.get(node) ?? [node]))
  let modularityScore = modularity(
    working,
    [...working.nodes].sort().map((node) => new Set([node])),
    resolution,
  )

  let level = oneLevel(working, m, partition, resolution)
  let result = level.partition.map((community) => new Set(community))

  // Bounded so a pathological graph cannot spin here inside a webhook handler.
  for (let depth = 0; level.improved && depth < 32; depth += 1) {
    result = level.partition.map((community) => new Set(community))
    const newModularity = modularity(working, level.innerPartition, resolution)
    if (newModularity - modularityScore <= threshold) break
    modularityScore = newModularity
    working = aggregate(working, level.innerPartition)
    level = oneLevel(working, m, level.partition, resolution)
  }

  return result
    .filter((community) => community.size >= minSize)
    .map((community) => [...community].sort())
    .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0))
}

/** The signal graph as the weighted graph Louvain consumes. Edge weight is the sum of that edge's
 *  signal confidences, exactly as graph_builder.py accumulates `weight`. */
function toWeightedGraph(g: SignalGraph): WeightedGraph {
  const nodes = [...g.nodes].sort()
  const adj = new Map<string, Map<string, number>>(nodes.map((n) => [n, new Map<string, number>()]))
  for (const [u, inner] of g.edges) {
    for (const [v, signals] of inner) {
      let weight = 0
      for (const signal of signals) weight += signal.confidence
      adj.get(u)?.set(v, weight)
      adj.get(v)?.set(u, weight)
    }
  }
  return { nodes, adj, members: new Map(nodes.map((n) => [n, new Set([n])])) }
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
    const address = normalizeAddress(acc.delivery_address)
    if (address) {
      const list = byAddress.get(address) ?? []
      list.push(acc.id)
      byAddress.set(address, list)
    }
  }
  addExactMatchSignals(g, byAddress, "shared_address", ADDRESS_CONFIDENCE)

  // 2. Shared Payment Fingerprint
  const byPayment = new Map<string, string[]>()
  for (const acc of accounts) {
    if (acc.payment_method_fingerprint) {
      const list = byPayment.get(acc.payment_method_fingerprint) ?? []
      list.push(acc.id)
      byPayment.set(acc.payment_method_fingerprint, list)
    }
  }
  addExactMatchSignals(g, byPayment, "shared_payment", PAYMENT_CONFIDENCE)

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
  addExactMatchSignals(g, byPhone, "shared_phone_pattern", PHONE_PATTERN_CONFIDENCE)

  // 4. Shared Promo within 24h & Coordinated Timing within 10min
  const txSorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  // Observation times per pair, grouped into occasions below, and the closest observed gap per
  // pair, which is what the confidence decay is computed from.
  const promoTimes = new Map<string, number[]>()
  const timingTimes = new Map<string, number[]>()
  const bestPromoDelta = new Map<string, number>()
  const bestTimingDelta = new Map<string, number>()

  for (let i = 0; i < txSorted.length; i++) {
    const tA = txSorted[i]!
    const timeA = new Date(tA.created_at).getTime()
    for (let j = i + 1; j < txSorted.length; j++) {
      const tB = txSorted[j]!
      const timeB = new Date(tB.created_at).getTime()
      const diffMs = timeB - timeA
      if (diffMs > PROMO_WINDOW_MS) break
      if (tA.account_id !== tB.account_id) {
        const [u, v] = [tA.account_id, tB.account_id].sort()
        const key = `${u}|${v}`
        if (tA.promo_code && tB.promo_code && tA.promo_code === tB.promo_code) {
          promoTimes.set(key, [...(promoTimes.get(key) ?? []), timeA])
          bestPromoDelta.set(key, Math.min(bestPromoDelta.get(key) ?? Infinity, diffMs))
        }
        if (diffMs <= TIMING_WINDOW_MS) {
          timingTimes.set(key, [...(timingTimes.get(key) ?? []), timeA])
          bestTimingDelta.set(key, Math.min(bestTimingDelta.get(key) ?? Infinity, diffMs))
        }
      }
    }
  }

  // Confidence is time-decayed exactly as graph_builder.py does it: a pair whose transactions sit
  // close together inside the window scores near the ceiling, a pair near its edge scores near the
  // floor. This used to be a flat 0.75 / 0.8 here, which fed avg_confidence a different number
  // than the Python path would have for the identical input, so two engines that agreed on the
  // evidence still disagreed on the score. The two-occasion floor below matches graph_builder.py
  // for the same reason. The clustering algorithms still differ (see the header), but nothing
  // downstream of the graph needs to.
  for (const [key, times] of promoTimes) {
    if (countOccasions(times, PROMO_WINDOW_MS) >= MIN_CORROBORATING_OCCASIONS) {
      const [u, v] = key.split("|") as [string, string]
      g.addSignal(
        u,
        v,
        "shared_promo",
        decayedConfidence(
          bestPromoDelta.get(key)!,
          PROMO_WINDOW_MS,
          PROMO_CONFIDENCE_FLOOR,
          PROMO_CONFIDENCE_CEILING,
        ),
      )
    }
  }
  for (const [key, times] of timingTimes) {
    if (countOccasions(times, TIMING_WINDOW_MS) >= MIN_CORROBORATING_OCCASIONS) {
      const [u, v] = key.split("|") as [string, string]
      g.addSignal(
        u,
        v,
        "coordinated_timing",
        decayedConfidence(
          bestTimingDelta.get(key)!,
          TIMING_WINDOW_MS,
          TIMING_CONFIDENCE_FLOOR,
          TIMING_CONFIDENCE_CEILING,
        ),
      )
    }
  }

  // 5. Community detection, the same Louvain modularity optimisation clustering.py runs.
  const clusters = louvainCommunities(toWeightedGraph(g), minClusterSize)

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
