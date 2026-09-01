CREATE TABLE "account_links" (
	"id" text PRIMARY KEY NOT NULL,
	"account_a" text NOT NULL,
	"account_b" text NOT NULL,
	"signal_type" text NOT NULL,
	"confidence" real NOT NULL,
	CONSTRAINT "account_links_signal_type_check" CHECK ("account_links"."signal_type" in ('shared_address', 'shared_payment', 'shared_phone_pattern', 'coordinated_timing', 'shared_promo')),
	CONSTRAINT "account_links_confidence_check" CHECK ("account_links"."confidence" >= 0 and "account_links"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_ref" text NOT NULL,
	"delivery_address" text,
	"payment_method_fingerprint" text,
	"phone_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_members" (
	"cluster_id" text NOT NULL,
	"account_id" text NOT NULL,
	CONSTRAINT "cluster_members_cluster_id_account_id_pk" PRIMARY KEY("cluster_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"risk_score" real NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"chargeback_exposure_paise" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clusters_status_check" CHECK ("clusters"."status" in ('pending_review', 'pending_verification', 'resolved')),
	CONSTRAINT "clusters_risk_score_check" CHECK ("clusters"."risk_score" >= 0 and "clusters"."risk_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "merchant_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_decisions_action_check" CHECK ("merchant_decisions"."action" in ('freeze', 'block', 'escalate', 'dismiss')),
	CONSTRAINT "merchant_decisions_dismiss_reason_check" CHECK ("merchant_decisions"."action" <> 'dismiss' or ("merchant_decisions"."reason" is not null and length(trim("merchant_decisions"."reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"razorpay_event_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"promo_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_razorpay_event_id_unique" UNIQUE("razorpay_event_id")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"account_id" text NOT NULL,
	"language_code" text NOT NULL,
	"transcript" text,
	"outcome" text NOT NULL,
	"confidence" real,
	CONSTRAINT "verifications_outcome_check" CHECK ("verifications"."outcome" in ('confirmed_linked', 'denied_linked', 'unclear', 'no_response'))
);
--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_account_a_accounts_id_fk" FOREIGN KEY ("account_a") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_account_b_accounts_id_fk" FOREIGN KEY ("account_b") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_decisions" ADD CONSTRAINT "merchant_decisions_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_links_account_a_idx" ON "account_links" USING btree ("account_a");--> statement-breakpoint
CREATE INDEX "account_links_account_b_idx" ON "account_links" USING btree ("account_b");--> statement-breakpoint
CREATE UNIQUE INDEX "account_links_pair_signal_uidx" ON "account_links" USING btree ("account_a","account_b","signal_type");--> statement-breakpoint
CREATE INDEX "accounts_delivery_address_idx" ON "accounts" USING btree ("delivery_address");--> statement-breakpoint
CREATE INDEX "accounts_payment_method_fingerprint_idx" ON "accounts" USING btree ("payment_method_fingerprint");--> statement-breakpoint
CREATE INDEX "accounts_phone_number_idx" ON "accounts" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "audit_log_cluster_id_idx" ON "audit_log" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "cluster_members_account_id_idx" ON "cluster_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "clusters_status_idx" ON "clusters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "merchant_decisions_cluster_id_idx" ON "merchant_decisions" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "transactions_account_id_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_promo_code_idx" ON "transactions" USING btree ("promo_code");--> statement-breakpoint
CREATE INDEX "verifications_cluster_id_idx" ON "verifications" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "verifications_account_id_idx" ON "verifications" USING btree ("account_id");