-- The 30-day Razorpay session.
--
-- Before this, connecting stored a credential and nothing else: the merchant had to come back and
-- press "run analysis" for anything to happen, and the credential sat there indefinitely. These
-- columns turn that into a standing session that expires on its own.
--
--   expires_at                  hard stop, 30 days from connect. The background poller skips a
--                               connection past this date and the dashboard asks for a reconnect.
--                               A stored secret that never expires is a liability; making the
--                               merchant re-consent every 30 days is the point, not a limitation.
--   auto_sync_enabled           pause polling without deleting the credential. Pausing and
--                               disconnecting are different intentions and should not share a
--                               button.
--   last_auto_sync_at           when the agent last looked on its own, as distinct from
--                               last_synced_at, which is when data last actually moved.
--   backfill_*                  the first pass over the merchant's existing payment history. This
--                               is what makes PAST fraud visible on day one instead of only
--                               transactions that arrive after connecting.
--
-- Nullable / defaulted throughout so an existing row keeps working: an already-connected merchant
-- is treated as never-backfilled and gets an expiry the next time they connect.
--
-- Hand-written, not drizzle-kit generated (registries unreachable). Matches
-- packages/db/src/schema/razorpay.ts exactly.

ALTER TABLE "razorpay_connections" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
ALTER TABLE "razorpay_connections" ADD COLUMN IF NOT EXISTS "auto_sync_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "razorpay_connections" ADD COLUMN IF NOT EXISTS "last_auto_sync_at" timestamp;
ALTER TABLE "razorpay_connections" ADD COLUMN IF NOT EXISTS "backfill_started_at" timestamp;
ALTER TABLE "razorpay_connections" ADD COLUMN IF NOT EXISTS "backfill_completed_at" timestamp;
ALTER TABLE "razorpay_connections" ADD COLUMN IF NOT EXISTS "backfill_payments_ingested" integer DEFAULT 0 NOT NULL;
ALTER TABLE "razorpay_connections" ADD COLUMN IF NOT EXISTS "backfill_status" text;

CREATE INDEX IF NOT EXISTS "razorpay_connections_expires_at_idx" ON "razorpay_connections" ("expires_at");
