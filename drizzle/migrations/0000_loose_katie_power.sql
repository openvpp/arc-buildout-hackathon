CREATE TABLE IF NOT EXISTS "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"enode_connection_id" uuid,
	"provider" text DEFAULT 'enode' NOT NULL,
	"external_device_id" text NOT NULL,
	"device_type" text DEFAULT 'vehicle' NOT NULL,
	"vendor" text,
	"model" text,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"nft_token_id" text,
	"nft_contract_address" text,
	"nft_transaction_hash" text,
	"nft_metadata_uri" text,
	"network" text,
	"mint_status" text DEFAULT 'unminted' NOT NULL,
	"mint_claimed_at" timestamp with time zone,
	"last_latitude" numeric(9, 6),
	"last_longitude" numeric(9, 6),
	"last_location_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_status_check" CHECK ("devices"."status" in ('active', 'inactive', 'disconnected')),
	CONSTRAINT "devices_mint_status_check" CHECK ("devices"."mint_status" in ('unminted', 'pending', 'minted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enode_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_user_id" text NOT NULL,
	"wallet_id" uuid NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enode_connections_status_check" CHECK ("enode_connections"."status" in ('connected', 'disconnected', 'error'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" in ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_device_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"normalized_wallet_address" text NOT NULL,
	"brand" text NOT NULL,
	"normalized_brand" text NOT NULL,
	"provider" text DEFAULT 'enode' NOT NULL,
	"provider_user_id" text,
	"provider_device_id" text,
	"provider_data" jsonb,
	"link_url" text,
	"status" text DEFAULT 'pending_oauth' NOT NULL,
	"request_metadata" jsonb,
	"form_data" jsonb,
	"result_device_id" uuid,
	"error" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_device_connections_status_check" CHECK ("pending_device_connections"."status" in ('pending_oauth', 'oauth_completed', 'pending_form', 'completed', 'failed', 'expired', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "principal_wallets" (
	"principal_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principal_wallets_principal_id_wallet_id_pk" PRIMARY KEY("principal_id","wallet_id"),
	CONSTRAINT "principal_wallets_role_check" CHECK ("principal_wallets"."role" in ('owner', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'dashboard_user' NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_type_check" CHECK ("principals"."type" in ('dashboard_user')),
	CONSTRAINT "principals_status_check" CHECK ("principals"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"normalized_address" text NOT NULL,
	"wallet_type" text DEFAULT 'circle' NOT NULL,
	"circle_wallet_id" text,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_status_check" CHECK ("wallets"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'enode' NOT NULL,
	"delivery_id" text NOT NULL,
	"raw_body" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."status" in ('received', 'processed', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_enode_connection_id_enode_connections_id_fk" FOREIGN KEY ("enode_connection_id") REFERENCES "public"."enode_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enode_connections" ADD CONSTRAINT "enode_connections_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_device_connections" ADD CONSTRAINT "pending_device_connections_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "principal_wallets" ADD CONSTRAINT "principal_wallets_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "principal_wallets" ADD CONSTRAINT "principal_wallets_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_provider_external_device_uidx" ON "devices" USING btree ("provider","external_device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_wallet_idx" ON "devices" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_wallet_status_idx" ON "devices" USING btree ("wallet_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enode_connections_external_user_uidx" ON "enode_connections" USING btree ("external_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enode_connections_wallet_idx" ON "enode_connections" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_status_available_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_device_connections_wallet_idx" ON "pending_device_connections" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_device_connections_status_idx" ON "pending_device_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "principal_wallets_wallet_idx" ON "principal_wallets" USING btree ("wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "principals_type_display_name_uidx" ON "principals" USING btree ("type","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_chain_normalized_address_uidx" ON "wallets" USING btree ("chain_id","normalized_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_circle_wallet_id_uidx" ON "wallets" USING btree ("circle_wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_status_idx" ON "wallets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_provider_delivery_uidx" ON "webhook_deliveries" USING btree ("provider","delivery_id");