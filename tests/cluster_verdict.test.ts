/**
 * The one-sentence verdict shown at the top of a ring detail page.
 *
 * Two of the three outcomes this function produces cannot be reached through the dashboard:
 * POST /api/clusters/detect only persists clusters at or above the flag threshold, so a merchant
 * never opens a capped or below-threshold case. They are still real branches - a future endpoint
 * that surfaces near-misses, or a detector run whose ceiling fires, would land on them - and an
 * unreachable branch is exactly the kind that rots. So they are pinned here rather than left to
 * the UI to exercise, which it cannot.
 *
 * The wording matters as much as the classification: the whole point of this block is that someone
 * who has never seen the taxonomy can read one sentence and know why a group was flagged.
 */

import { expect, test } from "bun:test"

// Relative, like tests/test_detector_parity.mjs reaches into api/hono: the `@/` alias is defined
// by web/next's tsconfig and does not resolve from this directory. Imports *inside* the module
// still use `@/` and resolve fine, because they are resolved against that tsconfig.
import { buildClusterVerdict } from "../web/next/src/components/fraud/cluster-verdict"

test("flagged on a strong signal: names the signal and says no household does it", () => {
  const v = buildClusterVerdict({
    accountCount: 6,
    riskScore: 0.79,
    signalTypes: ["shared_address", "shared_payment", "coordinated_timing", "shared_phone_pattern"],
    ceilingApplied: false,
  })

  expect(v.outcome).toBe("flagged")
  expect(v.headline).toBe(
    "6 accounts are linked by phone numbers from one sequential block. No ordinary household produces that.",
  )
  expect(v.scoreLine).toBe("Scored 0.79. The line is 0.45.")

  // Strong signals lead, the benign ones are discounted rather than dropped silently.
  expect(v.drivers.map((d) => d.signalType)).toEqual(["shared_phone_pattern", "coordinated_timing"])
  expect(v.discounted).toEqual(["shared delivery address", "shared payment method"])
})

test("two strong signals are joined into one readable sentence", () => {
  const v = buildClusterVerdict({
    accountCount: 4,
    riskScore: 0.88,
    signalTypes: ["shared_promo", "shared_phone_pattern"],
    ceilingApplied: false,
  })

  expect(v.headline).toBe(
    "4 accounts are linked by the same promo code funnelled through several accounts and phone numbers from one sequential block. No ordinary household produces that.",
  )
})

test("weak signals only: does not claim a household could never do it", () => {
  const v = buildClusterVerdict({
    accountCount: 3,
    riskScore: 0.51,
    signalTypes: ["shared_address", "coordinated_timing"],
    ceilingApplied: false,
  })

  expect(v.outcome).toBe("flagged")
  expect(v.headline).toContain("on top of what a household would share")
  expect(v.headline).not.toContain("No ordinary household produces that")
})

test("ceiling applied: says it is not a ring, and that the cap was deliberate", () => {
  const v = buildClusterVerdict({
    accountCount: 5,
    riskScore: 0.35,
    signalTypes: ["shared_address", "shared_payment"],
    ceilingApplied: true,
  })

  expect(v.outcome).toBe("capped")
  expect(v.headline).toContain("Not a ring")
  expect(v.headline).toContain("held below the line on purpose")
  expect(v.drivers).toEqual([])
})

test("below threshold without the ceiling: not flagged, and says why", () => {
  const v = buildClusterVerdict({
    accountCount: 3,
    riskScore: 0.39,
    signalTypes: ["coordinated_timing"],
    ceilingApplied: false,
  })

  expect(v.outcome).toBe("below_threshold")
  expect(v.headline).toContain("Not flagged")
  expect(v.headline).toContain("not by enough independent signals")
})

test("the threshold in the sentence is the detector's, not a hardcoded copy of it", () => {
  const v = buildClusterVerdict({
    accountCount: 2,
    riskScore: 0.6,
    signalTypes: ["shared_promo"],
    ceilingApplied: false,
    flagThreshold: 0.7,
  })

  expect(v.outcome).toBe("below_threshold")
  expect(v.scoreLine).toBe("Scored 0.60. The line is 0.70.")
})

test("an unknown signal type is still named rather than dropped", () => {
  const v = buildClusterVerdict({
    accountCount: 2,
    riskScore: 0.8,
    signalTypes: ["shared_device_id"],
    ceilingApplied: false,
  })

  // Unclassified signals fall to benign_explainable, so this one is discounted, not a driver -
  // but it must still appear, because silently ignoring a signal the detector scored on would
  // make the verdict disagree with the audit trail below it.
  expect(v.discounted).toEqual(["shared_device_id"])
})
