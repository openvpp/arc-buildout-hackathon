CREATE TABLE IF NOT EXISTS "event_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_event_id" uuid NOT NULL,
	"buyer_kind" text NOT NULL,
	"principal_id" uuid,
	"agent_address" text,
	"payer_address" text NOT NULL,
	"seller_address" text NOT NULL,
	"network" text NOT NULL,
	"asset" text NOT NULL,
	"amount_atomic" bigint NOT NULL,
	"settlement_reference" text NOT NULL,
	"settlement_status" text DEFAULT 'accepted' NOT NULL,
	"settlement_tx_hash" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_unlocks_buyer_kind_check" CHECK (("event_unlocks"."buyer_kind" = 'owner' and "event_unlocks"."principal_id" is not null and "event_unlocks"."agent_address" is null) or ("event_unlocks"."buyer_kind" = 'agent' and "event_unlocks"."agent_address" is not null and "event_unlocks"."principal_id" is null) or ("event_unlocks"."buyer_kind" = 'admin' and "event_unlocks"."principal_id" is null and "event_unlocks"."agent_address" is null)),
	CONSTRAINT "event_unlocks_settlement_status_check" CHECK ("event_unlocks"."settlement_status" in ('accepted', 'settled', 'failed')),
	CONSTRAINT "event_unlocks_settled_has_tx_check" CHECK ("event_unlocks"."settlement_status" <> 'settled' or ("event_unlocks"."settlement_tx_hash" is not null and "event_unlocks"."settled_at" is not null)),
	CONSTRAINT "event_unlocks_amount_check" CHECK ("event_unlocks"."amount_atomic" > 0),
	CONSTRAINT "event_unlocks_lowercase_addresses_check" CHECK ("event_unlocks"."payer_address" = lower("event_unlocks"."payer_address") and "event_unlocks"."seller_address" = lower("event_unlocks"."seller_address") and ("event_unlocks"."agent_address" is null or "event_unlocks"."agent_address" = lower("event_unlocks"."agent_address")))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_unlocks" ADD CONSTRAINT "event_unlocks_device_event_id_device_events_id_fk" FOREIGN KEY ("device_event_id") REFERENCES "public"."device_events"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_unlocks" ADD CONSTRAINT "event_unlocks_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_unlocks_settlement_reference_uidx" ON "event_unlocks" USING btree ("settlement_reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_unlocks_owner_uidx" ON "event_unlocks" USING btree ("device_event_id","principal_id") WHERE "event_unlocks"."buyer_kind" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_unlocks_agent_uidx" ON "event_unlocks" USING btree ("device_event_id","agent_address") WHERE "event_unlocks"."buyer_kind" = 'agent';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_unlocks_admin_uidx" ON "event_unlocks" USING btree ("device_event_id") WHERE "event_unlocks"."buyer_kind" = 'admin';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_unlocks_payer_created_idx" ON "event_unlocks" USING btree ("payer_address","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_unlocks_accepted_idx" ON "event_unlocks" USING btree ("created_at") WHERE "event_unlocks"."settlement_status" = 'accepted';