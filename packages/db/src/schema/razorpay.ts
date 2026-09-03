import { sql } from "drizzle-orm"
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { check } from "drizzle-orm/pg-core"

// A merchant's connection to their own Razorpay account (Architecture.md §6 - the live ingestion
// path that replaces manual CSV export).
//
// SECURITY NOTES, because this table holds a credential:
//   - key_secret is stored ENCRYPTED (AES-256-GCM, api/hono/src/lib/crypto.ts), never plaintext.
//     The encryption key comes from RAZORPAY_CREDENTIAL_KEY in the environment; if that is unset
//     the API refuses to store a secret at all rather than falling back to plaintext.
//   - key_id is stored in the clear on purpose: it is not a secret (it ships in client-side
//     checkout code), and having it readable is what lets the dashboard show WHICH account is
//     connected without decrypting anything.
//   - Nothing in this system ever needs a write scope on the merchant's Razorpay account. The
//     client only ever issues GET /v1/payments (Rules.md Principle 1 extends here: the agent
//     cannot act on a merchant's payments even if a bug tried to).
export const razorpayConnections = pgTable(
  "razorpay_connections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // "test" | "live". Razorpay key ids are prefixed rzp_test_ / rzp_live_, so this is derivable,
    // but storing it explicitly means the UI can warn loudly about a live-mode connection without
    // parsing a credential to find out.
    mode: text("mode").notNull(),
    keyId: text("key_id").notNull(),
    keySecretEncrypted: text("key_secret_encrypted").notNull(),
    // Set once a sync has actually succeeded, so the next sync can ask Razorpay only for payments
    // created since then rather than re-pulling the merchant's whole history every time.
    lastSyncedAt: timestamp("last_synced_at"),
    lastSyncStatus: text("last_sync_status"),

    // ---- the 30-day session -------------------------------------------------------------
    //
    // A merchant should connect once and then stop thinking about it. These columns are what
    // turn a stored credential into a standing session:
    //
    //   expiresAt          hard stop. After this the poller ignores the connection and the
    //                      dashboard asks the merchant to reconnect. A stored API secret that
    //                      works forever is a liability; one that expires is a decision the
    //                      merchant gets to re-make.
    //   autoSyncEnabled    the merchant can pause the polling without disconnecting, which is
    //                      not the same thing as deleting the credential.
    //   lastAutoSyncAt     separate from lastSyncedAt on purpose: one records when the agent
    //                      last looked by itself, the other when data last actually moved.
    //   backfill*          the first pass over the merchant's existing payment history, which
    //                      is what makes past fraud visible on day one rather than only new
    //                      transactions from the moment of connection.
    expiresAt: timestamp("expires_at"),
    autoSyncEnabled: boolean("auto_sync_enabled").default(true).notNull(),
    lastAutoSyncAt: timestamp("last_auto_sync_at"),
    backfillStartedAt: timestamp("backfill_started_at"),
    backfillCompletedAt: timestamp("backfill_completed_at"),
    backfillPaymentsIngested: integer("backfill_payments_ingested").default(0).notNull(),
    backfillStatus: text("backfill_status"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("razorpay_connections_created_at_idx").on(table.createdAt),
    index("razorpay_connections_expires_at_idx").on(table.expiresAt),
    check("razorpay_connections_mode_check", sql`${table.mode} in ('test', 'live')`),
  ],
)
