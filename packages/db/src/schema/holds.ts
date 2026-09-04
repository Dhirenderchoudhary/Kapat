import { sql } from "drizzle-orm"
import { bigint, check, index, pgTable, real, text, timestamp } from "drizzle-orm/pg-core"

import { accounts } from "@/schema/fraud"

/**
 * A payment the agent has HELD for merchant review.
 *
 * The mechanism is Razorpay's manual capture, not anything invented here. A payment in the
 * `authorized` state has the customer's funds held but NOT settled to the merchant. Razorpay keeps
 * it there for up to 3 days; capture it and the money settles, do nothing and it is automatically
 * refunded to the customer. That window is the entire product surface for this feature:
 *
 *   agent detects risk on payment.authorized  ->  does NOT capture  ->  row here
 *   merchant releases  ->  POST /v1/payments/:id/capture  ->  money settles
 *   merchant rejects   ->  refund, or simply let the window expire
 *
 * Principle 1 in its strongest form: the agent's power is limited to NOT ACTING. It never
 * captures, never refunds, never cancels. Declining to capture is the only lever it has, and even
 * that reverses itself automatically in the customer's favour if no human decides. A held payment
 * that everyone forgets about ends up refunded to the customer, which is the correct failure mode
 * for a system that might be wrong.
 *
 * `expires_at` is stored rather than derived so the dashboard countdown and any reminder job read
 * one authoritative deadline. It is set from the payment's own authorization time, not from when we
 * happened to receive the webhook - a delayed delivery must not appear to buy extra hours.
 */
export const paymentHolds = pgTable(
  "payment_holds",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Razorpay payment id (pay_...). Unique: one hold per payment, enforced by the database so a
    // redelivered webhook cannot open a second hold on the same money (Principle 3).
    razorpayPaymentId: text("razorpay_payment_id").notNull().unique(),
    razorpayOrderId: text("razorpay_order_id"),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),

    // held -> released | rejected | expired
    status: text("status").notNull().default("held"),
    // The ring risk score that caused the hold, copied at hold time. Copied rather than joined so
    // the record of WHY this was held cannot change later if the cluster is re-scored.
    riskScoreAtHold: real("risk_score_at_hold"),
    clusterId: text("cluster_id"),
    reason: text("reason").notNull(),

    // Merchant decision.
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    // What Razorpay said when we acted on the merchant's decision - success or the API error.
    // Stored so a failed capture is visible rather than silently leaving a "released" row that
    // never actually settled.
    razorpayResult: text("razorpay_result"),

    authorizedAt: timestamp("authorized_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("payment_holds_status_idx").on(table.status),
    index("payment_holds_expires_at_idx").on(table.expiresAt),
    index("payment_holds_account_id_idx").on(table.accountId),
    check(
      "payment_holds_status_check",
      sql`${table.status} in ('held', 'released', 'rejected', 'expired')`,
    ),
    // A decided hold must record who decided it. Enforced here, not in the application, for the
    // same reason merchant_decisions.reason is (Principle 10): the audit trail is only worth
    // anything if it cannot be bypassed.
    check(
      "payment_holds_decided_by_check",
      sql`${table.status} in ('held', 'expired') or (${table.decidedBy} is not null and length(trim(${table.decidedBy})) > 0)`,
    ),
  ],
)
