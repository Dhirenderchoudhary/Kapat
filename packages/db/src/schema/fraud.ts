import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

// AI Risk Manager: Fraud Ring Detection Platform - Architecture.md §5 is the logical reference
// this file implements. Two principles from the governing principles are enforced here at the database level,
// not just in application code or UI copy:
//   Principle 9  - every account_links edge carries a labeled signal_type and confidence.
//   Principle 10 - merchant_decisions.reason is required when action = "dismiss".
// transactions.razorpay_event_id is unique so idempotent webhook ingestion is a database
// constraint (Principle 3), not an application-level check.
//
// Naming note: "accounts" here is the fraud-platform customer account (the node in the fraud
// graph) - a different table from Better Auth's singular "account" in auth.ts (an OAuth provider
// link on a dashboard user). Same word, deliberately different table, per Architecture.md §5.

export const accounts = pgTable(
  "accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerRef: text("customer_ref").notNull(),
    deliveryAddress: text("delivery_address"),
    paymentMethodFingerprint: text("payment_method_fingerprint"),
    phoneNumber: text("phone_number"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // graph_builder.py joins accounts on these three columns to find shared-signal edges.
    index("accounts_delivery_address_idx").on(table.deliveryAddress),
    index("accounts_payment_method_fingerprint_idx").on(table.paymentMethodFingerprint),
    index("accounts_phone_number_idx").on(table.phoneNumber),
    // FR-11: idempotent ingestion covers accounts too, not just transactions -
    // POST /webhooks/razorpay upserts on customer_ref, so this is the real guarantee (the governing principles
    // Principle 3), not an application-level check (migration 0005).
    uniqueIndex("accounts_customer_ref_uidx").on(table.customerRef),
  ],
)

export const transactions = pgTable(
  "transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Unique, not just checked in application code: a redelivered Razorpay webhook event must
    // not create a duplicate transaction (Principle 3).
    razorpayEventId: text("razorpay_event_id").notNull().unique(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    promoCode: text("promo_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("transactions_account_id_idx").on(table.accountId),
    index("transactions_promo_code_idx").on(table.promoCode),
  ],
)

// The graph edges. Every row is one specific shared signal between two accounts - never an
// unlabeled connection (Principle 9). The dashboard's evidence panel and graph hover
// tooltips (Design.md §1.2, §2) read directly off signal_type and confidence.
export const accountLinks = pgTable(
  "account_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountA: text("account_a")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    accountB: text("account_b")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // shared_address | shared_payment | shared_phone_pattern | coordinated_timing | shared_promo.
    signalType: text("signal_type").notNull(),
    confidence: real("confidence").notNull(),
  },
  (table) => [
    index("account_links_account_a_idx").on(table.accountA),
    index("account_links_account_b_idx").on(table.accountB),
    // Lets graph_builder.py re-run without creating duplicate edges for the same pair+signal.
    uniqueIndex("account_links_pair_signal_uidx").on(
      table.accountA,
      table.accountB,
      table.signalType,
    ),
    check(
      "account_links_signal_type_check",
      sql`${table.signalType} in ('shared_address', 'shared_payment', 'shared_phone_pattern', 'coordinated_timing', 'shared_promo')`,
    ),
    check(
      "account_links_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
)

export const clusters = pgTable(
  "clusters",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    riskScore: real("risk_score").notNull(),
    // pending_review | pending_verification | resolved.
    status: text("status").notNull().default("pending_review"),
    chargebackExposurePaise: bigint("chargeback_exposure_paise", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("clusters_status_idx").on(table.status),
    check(
      "clusters_status_check",
      sql`${table.status} in ('pending_review', 'pending_verification', 'resolved')`,
    ),
    check("clusters_risk_score_check", sql`${table.riskScore} >= 0 and ${table.riskScore} <= 1`),
  ],
)

export const clusterMembers = pgTable(
  "cluster_members",
  {
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.clusterId, table.accountId] }),
    // The account drill-down (Design.md §1.3) lists every cluster an account has appeared in,
    // past and present - that query narrows on account_id, so it earns its own index even though
    // account_id is half of the composite primary key.
    index("cluster_members_account_id_idx").on(table.accountId),
  ],
)

export const verifications = pgTable(
  "verifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull(),
    transcript: text("transcript"),
    // confirmed_linked | denied_linked | unclear | no_response.
    // Meaning is inverted vs. a single-transaction verifier:
    // confirmed here leans legitimate (family/shared household), denied strengthens the ring
    // hypothesis. Get this the right way round in response_parser.py and the dashboard labels.
    outcome: text("outcome").notNull(),
    confidence: real("confidence"),
  },
  (table) => [
    index("verifications_cluster_id_idx").on(table.clusterId),
    index("verifications_account_id_idx").on(table.accountId),
    check(
      "verifications_outcome_check",
      sql`${table.outcome} in ('confirmed_linked', 'denied_linked', 'unclear', 'no_response')`,
    ),
  ],
)

export const merchantDecisions = pgTable(
  "merchant_decisions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    // freeze | block | escalate | dismiss. Only this row may trigger the executor, and only
    // after it exists (Principle 1) - never a cluster's risk_score or a verification
    // outcome acting directly.
    action: text("action").notNull(),
    // Required when action = "dismiss" (Principle 10), enforced below so the
    // false-positive-cost metric can never be built on an unreasoned dismissal.
    reason: text("reason"),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at").defaultNow().notNull(),
  },
  (table) => [
    index("merchant_decisions_cluster_id_idx").on(table.clusterId),
    check(
      "merchant_decisions_action_check",
      sql`${table.action} in ('freeze', 'block', 'escalate', 'dismiss')`,
    ),
    check(
      "merchant_decisions_dismiss_reason_check",
      sql`${table.action} <> 'dismiss' or (${table.reason} is not null and length(trim(${table.reason})) > 0)`,
    ),
  ],
)

// One structured record per cluster event (decision made, executor acted, verification
// completed, and so on), so GET /api/clusters/:id can assemble the full evidence -> verification
// -> decision -> execution chain in one call (Principle 2).
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("audit_log_cluster_id_idx").on(table.clusterId)],
)
