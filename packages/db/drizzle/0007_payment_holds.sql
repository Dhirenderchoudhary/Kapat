-- Phase 15: transaction holds.
--
-- Backs the "hold, don't cancel" feature. The mechanism is Razorpay manual capture: a payment in
-- the authorized state has funds held but unsettled for up to 3 days. The agent declines to
-- capture; the merchant releases (capture) or rejects (refund). If nobody decides, Razorpay
-- auto-refunds the customer - the correct failure mode for a system that might be wrong.
--
-- Hand-written, not drizzle-kit generated (drizzle-kit could not run in the environment these
-- migrations were written in). Matches packages/db/src/schema/holds.ts exactly.
CREATE TABLE IF NOT EXISTS "payment_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"razorpay_order_id" text,
	"account_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"risk_score_at_hold" real,
	"cluster_id" text,
	"reason" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"decision_note" text,
	"razorpay_result" text,
	"authorized_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_holds_razorpay_payment_id_unique" UNIQUE ("razorpay_payment_id"),
	CONSTRAINT "payment_holds_status_check" CHECK ("status" in ('held', 'released', 'rejected', 'expired')),
	CONSTRAINT "payment_holds_decided_by_check" CHECK ("status" in ('held', 'expired') or ("decided_by" is not null and length(trim("decided_by")) > 0))
);
--> statement-breakpoint
ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_holds_account_id_accounts_id_fk"
	FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_holds_status_idx" ON "payment_holds" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_holds_expires_at_idx" ON "payment_holds" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_holds_account_id_idx" ON "payment_holds" USING btree ("account_id");
