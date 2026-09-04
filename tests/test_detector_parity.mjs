/**
 * Parity between the two detector engines, on the axis where they are supposed to agree.
 *
 * api/hono/src/lib/detector.ts is the TypeScript fallback that runs when the Python
 * detector-service is unreachable (serverless, or a cloud deploy with no sidecar). It is NOT a
 * full port: it groups accounts with connected components where clustering.py runs Louvain, and
 * that difference is documented at the top of the file and reported at runtime as `engine` and
 * `clusteringMethod`.
 *
 * Everything downstream of the graph, though, is meant to be identical: the same signals, the same
 * confidences, the same corroboration-gated score, the same ceiling. It was not. The fallback
 * derived coordinated_timing at a flat 0.8 and shared_promo at a flat 0.75 where graph_builder.py
 * time-decays both into a band, so two engines that agreed on which accounts were linked still
 * disagreed on the number a merchant sees. These fixtures pin the values the Python side produces
 * for the same input, so that divergence cannot come back unnoticed.
 *
 * The expected numbers below are not hand-computed. They are what
 * services/detector-service/{graph_builder,clustering,cluster_scorer}.py return for these exact
 * accounts and transactions.
 *
 * Run: node tests/test_detector_parity.mjs
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import { detectRingsPure } from "../api/hono/src/lib/detector.ts"

const T0 = new Date("2026-06-01T00:00:00Z").getTime()
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString()

const account = (id, address, fingerprint, phone) => ({
  id,
  delivery_address: address,
  payment_method_fingerprint: fingerprint,
  phone_number: phone,
  created_at: at(0),
})
const txn = (id, accountId, minutes, promo = null) => ({
  id,
  account_id: accountId,
  amount_paise: 120_000,
  promo_code: promo,
  created_at: at(minutes),
})

// A ring: one address, one card, a sequential SIM block, and one promo code funnelled through the
// group on two separate days (two occasions, so the corroboration floor is genuinely cleared).
const RING_ACCOUNTS = [0, 1, 2].map((i) =>
  account(`r${i + 1}`, "12 MG Road", "visa_4242", `+91987654321${i}`),
)
const RING_TXNS = [
  txn("t1", "r1", 0, "WELCOME50"),
  txn("t2", "r2", 2, "WELCOME50"),
  txn("t3", "r1", 5760, "WELCOME50"),
  txn("t4", "r2", 5762, "WELCOME50"),
  txn("t5", "r3", 5764, "WELCOME50"),
]

// A household: one address and one family card, and nothing else. The ceiling rule's whole point.
const HOUSEHOLD_ACCOUNTS = [0, 1].map((i) =>
  account(`h${i + 1}`, "8 Linking Road", "mc_1111", `+91900000${i}00`),
)
const HOUSEHOLD_TXNS = [txn("t6", "h1", 0), txn("t7", "h2", 900)]

const signalMap = (cluster) => {
  const out = {}
  for (const e of cluster.score.evidence) out[e.signal_type] = e.confidence
  return out
}

test("ring: scores identically to the Python detector, including time-decayed confidences", () => {
  const [cluster, ...rest] = detectRingsPure(RING_ACCOUNTS, RING_TXNS, 2)
  assert.equal(rest.length, 0, "expected exactly one cluster")
  assert.deepEqual(cluster.member_account_ids, ["r1", "r2", "r3"])
  assert.equal(cluster.score.risk_score, 0.9264)
  assert.equal(cluster.score.flagged, true)
  assert.equal(cluster.score.ceiling_applied, false)
  assert.deepEqual(signalMap(cluster), {
    shared_address: 0.9,
    shared_payment: 0.85,
    shared_phone_pattern: 0.7,
    // Both decayed, not flat. A regression to the old hardcoded 0.8 / 0.75 fails here.
    coordinated_timing: 0.86,
    shared_promo: 0.8,
  })
})

test("household: capped by the ceiling rule, exactly as the Python detector caps it", () => {
  const [cluster, ...rest] = detectRingsPure(HOUSEHOLD_ACCOUNTS, HOUSEHOLD_TXNS, 2)
  assert.equal(rest.length, 0, "expected exactly one cluster")
  assert.equal(cluster.score.risk_score, 0.344)
  assert.equal(cluster.score.flagged, false)
  assert.equal(
    cluster.score.ceiling_applied,
    true,
    "an address plus a card has a complete innocent explanation",
  )
  assert.deepEqual(signalMap(cluster), { shared_address: 0.9, shared_payment: 0.85 })
})

test("a single shared session does not manufacture a coordinated_timing signal", () => {
  // Same rule as tests/test_graph_builder.py: repetition means separate occasions, not many
  // transaction pairs inside one window. Two people, one evening, several items each.
  const accounts = [account("s1", null, null, null), account("s2", null, null, null)]
  const oneSession = [
    txn("a1", "s1", 0),
    txn("a2", "s1", 1),
    txn("a3", "s1", 2),
    txn("b1", "s2", 1),
    txn("b2", "s2", 2),
    txn("b3", "s2", 3),
  ]
  assert.deepEqual(detectRingsPure(accounts, oneSession, 2), [])
})

// ---------------------------------------------------------------- dataset-level clustering parity
//
// The fixture holds the communities networkx Louvain (seed=42) returns for the held-out split, so
// this asserts the TypeScript fallback groups accounts the same way the Python service does on the
// data every published metric comes from. It is the regression guard for the change that replaced
// connected-components grouping here: components merged 966 accounts of hard_train into a single
// "cluster" because a chain of shared addresses links them transitively, which is not a near-miss
// but a different answer.
//
// Regenerate the fixture (from the repo root) if the signal derivation changes on purpose:
//
//   python -c "import json,pathlib,sys; sys.path.insert(0,'services/detector-service'); \
//   import graph_builder,clustering; d=json.loads(pathlib.Path('data/detector_test.json').read_text()); \
//   g=graph_builder.build_graph(d['accounts'],d['transactions']); \
//   print(json.dumps(sorted([sorted(c) for c in clustering.find_clusters(g,min_size=2)])))"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const fixture = JSON.parse(
  readFileSync(`${here}fixtures/python_clusters_detector_test.json`, "utf8"),
)
const dataset = JSON.parse(readFileSync(`${here}../data/detector_test.json`, "utf8"))

test("clustering: the fallback finds the same communities as networkx Louvain on the held-out split", () => {
  const found = detectRingsPure(dataset.accounts, dataset.transactions, fixture.min_cluster_size)
    .map((c) => [...c.member_account_ids].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const expected = [...fixture.communities]
    .map((c) => [...c].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  assert.equal(found.length, expected.length, "different number of communities than Python found")
  assert.deepEqual(found, expected)
})
