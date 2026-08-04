CREATE TABLE "enode_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_key" text NOT NULL,
	"access_token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_device_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"normalized_wallet_address" text NOT NULL,
	"wallet_id" uuid,
	"environment" text DEFAULT 'production' NOT NULL,
	"device_type" text DEFAULT 'electric_vehicle' NOT NULL,
	"brand" text NOT NULL,
	"normalized_brand" text NOT NULL,
	"provider" text DEFAULT 'enode' NOT NULL,
	"provider_vendor_id" text,
	"status" text DEFAULT 'pending_oauth' NOT NULL,
	"link_url" text,
	"provider_connection_id" text,
	"provider_device_id" text,
	"provider_user_id" text,
	"provider_data" jsonb,
	"form_data" jsonb,
	"error" jsonb,
	"request_metadata" jsonb,
	"result_device_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_device_connections_status_check" CHECK ("pending_device_connections"."status" in ('pending_oauth', 'oauth_completed', 'pending_form', 'completed', 'failed', 'expired', 'cancelled')),
	CONSTRAINT "pending_device_connections_provider_check" CHECK ("pending_device_connections"."provider" in ('enode'))
);
--> statement-breakpoint
ALTER TABLE "pending_device_connections" ADD CONSTRAINT "pending_device_connections_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_device_connections" ADD CONSTRAINT "pending_device_connections_result_device_id_devices_id_fk" FOREIGN KEY ("result_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enode_api_tokens_key_uidx" ON "enode_api_tokens" USING btree ("token_key");--> statement-breakpoint
CREATE INDEX "pending_device_connections_wallet_status_idx" ON "pending_device_connections" USING btree ("normalized_wallet_address","status");--> statement-breakpoint
CREATE INDEX "pending_device_connections_provider_device_idx" ON "pending_device_connections" USING btree ("provider","provider_device_id");--> statement-breakpoint
CREATE INDEX "pending_device_connections_expires_idx" ON "pending_device_connections" USING btree ("expires_at");