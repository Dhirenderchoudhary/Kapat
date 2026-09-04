-- Phase 13: live Razorpay ingestion.
--
-- Holds one row per connected Razorpay account. key_secret_encrypted is AES-256-GCM ciphertext
-- (api/hono/src/lib/crypto.ts) - never a plaintext secret. key_id is deliberately clear: it is not
-- a secret (it is shipped to browsers in Razorpay Checkout) and keeping it readable lets the
-- dashboard show which account is connected without touching the encryption key.
--
-- Hand-written, not drizzle-kit generated: bun/drizzle-kit remain unavailable in every environment
-- this project has run in (no network egress to the registries).
-- Matches packages/db/src/schema/razorpay.ts exactly. Run `bun run db:generate` once real network
-- access exists to regenerate a proper snapshot; it should confirm this change, not propose a new one.
CREATE TABLE IF NOT EXISTS "razorpay_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"key_id" text NOT NULL,
	"key_secret_encrypted" text NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "razorpay_connections_mode_check" CHECK ("mode" in ('test', 'live'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "razorpay_connections_created_at_idx" ON "razorpay_connections" USING btree ("created_at");
