import { clusterMembers, clusters, db, paymentHolds } from "@packages/db"
import { desc, eq, inArray } from "drizzle-orm"

import { holdExpiry } from "@/lib/razorpay-capture"

/**
 * Decides whether a newly authorized payment should be held for merchant review.
 *
 * The rule is deliberately narrow: hold a payment only when the account paying is already a member
 * of a cluster the ring detector FLAGGED. Nothing new is invented at payment time - no second
 * scoring model, no per-transaction heuristic that could disagree with the detector and produce two
 * different notions of "risky" in one product. If the detector would not put this account's ring in
 * the merchant's queue, its payments are not held.
 *
 * That has a consequence worth stating plainly: the FIRST payment from a brand-new ring is usually
 * NOT held, because the ring does not exist as a cluster until enough of its accounts and
 * transactions are in the graph for community detection to find it. This system catches a ring on
 * its second, fifth, twentieth payment - not its first. Any product claiming to catch the first
 * transaction of a previously unseen ring, from relationship signals alone, is claiming something
 * the data cannot support: at the moment of a first payment there are no relationships to observe.
 */

export type HoldDecision =
  | { hold: false; reason: string }
  | { hold: true; reason: string; riskScore: number; clusterId: string }

export async function decideHold(accountId: string): Promise<HoldDecision> {
  const memberships = await db
    .select({ clusterId: clusterMembers.clusterId })
    .from(clusterMembers)
    .where(eq(clusterMembers.accountId, accountId))

  if (memberships.length === 0) {
    return { hold: false, reason: "This account is not part of any detected ring." }
  }

  const ids = memberships.map((m) => m.clusterId)
  const rows = await db
    .select({ id: clusters.id, riskScore: clusters.riskScore, status: clusters.status })
    .from(clusters)
    .where(inArray(clusters.id, ids))
    .orderBy(desc(clusters.riskScore))

  // Only clusters the detector flagged are ever persisted, so any membership is a flagged ring.
  // Still take the highest-scoring one explicitly rather than assuming a single membership: an
  // account can legitimately appear in more than one detected grouping.
  const top = rows[0]
  if (!top) {
    return { hold: false, reason: "This account is not part of any detected ring." }
  }

  // A ring the merchant already decided on should not keep holding new payments - they have made
  // their call, and re-holding would override a human decision with an automated one.
  if (top.status === "resolved") {
    return { hold: false, reason: "This account's ring has already been decided by a merchant." }
  }

  return {
    hold: true,
    clusterId: top.id,
    riskScore: top.riskScore,
    reason: `This account belongs to ring ${top.id.slice(0, 12)}…, flagged at risk ${top.riskScore.toFixed(2)} and still awaiting a decision.`,
  }
}

/**
 * Records a hold. Idempotent on the Razorpay payment id at the database level, so a redelivered
 * webhook cannot open a second hold on the same money.
 *
 * Returns null when a hold already existed - the caller uses that to avoid re-announcing an
 * incident the merchant has already seen.
 */
export async function recordHold(params: {
  razorpayPaymentId: string
  razorpayOrderId?: string | null
  accountId: string
  amountPaise: number
  currency?: string
  authorizedAt: Date
  decision: Extract<HoldDecision, { hold: true }>
}): Promise<{ id: string; expiresAt: Date } | null> {
  const expiresAt = holdExpiry(params.authorizedAt)

  const [inserted] = await db
    .insert(paymentHolds)
    .values({
      razorpayPaymentId: params.razorpayPaymentId,
      razorpayOrderId: params.razorpayOrderId ?? null,
      accountId: params.accountId,
      amountPaise: params.amountPaise,
      currency: params.currency ?? "INR",
      status: "held",
      riskScoreAtHold: params.decision.riskScore,
      clusterId: params.decision.clusterId,
      reason: params.decision.reason,
      authorizedAt: params.authorizedAt,
      expiresAt,
    })
    .onConflictDoNothing({ target: paymentHolds.razorpayPaymentId })
    .returning({ id: paymentHolds.id })

  return inserted ? { id: inserted.id, expiresAt } : null
}
