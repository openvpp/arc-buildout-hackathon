CREATE TABLE "agent_device_cursors" (
	"principal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"last_delivered_record_id" uuid,
	"last_delivered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_device_cursors_principal_id_device_id_pk" PRIMARY KEY("principal_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "anchor_batch_records" (
	"batch_id" uuid NOT NULL,
	"telemetry_record_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anchor_batch_records_batch_id_telemetry_record_id_pk" PRIMARY KEY("batch_id","telemetry_record_id")
);
--> statement-breakpoint
CREATE TABLE "anchor_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_address" text NOT NULL,
	"contract_version" text NOT NULL,
	"batch_root" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"anchor_transaction_hash" text,
	"block_number" bigint,
	"block_hash" text,
	"log_index" integer,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anchor_batches_status_check" CHECK ("anchor_batches"."status" in ('pending', 'submitted', 'confirmed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_credentials_status_check" CHECK ("api_credentials"."status" in ('active', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text,
	"principal_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"result" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"enode_connection_id" uuid,
	"external_device_id" text NOT NULL,
	"device_type" text DEFAULT 'vehicle' NOT NULL,
	"vendor" text,
	"model" text,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_status_check" CHECK ("devices"."status" in ('active', 'inactive', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "enode_connections" (
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
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_method" text NOT NULL,
	"request_path" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_status_check" CHECK ("idempotency_records"."status" in ('processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"wallet_id" uuid,
	"payment_requirement_id" uuid,
	"payment_transaction_id" uuid,
	"entry_type" text NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"asset" text NOT NULL,
	"chain_id" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_type_check" CHECK ("ledger_entries"."entry_type" in ('payment_credit', 'telemetry_charge', 'refund_credit', 'adjustment_debit', 'adjustment_credit'))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" in ('pending', 'processing', 'completed', 'failed', 'dead_letter'))
);
--> statement-breakpoint
CREATE TABLE "payment_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"telemetry_record_id" uuid NOT NULL,
	"pricing_version" text NOT NULL,
	"network" text NOT NULL,
	"chain_id" bigint NOT NULL,
	"asset" text DEFAULT 'USDC' NOT NULL,
	"token_contract_address" text NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"amount_display" text NOT NULL,
	"decimals" integer DEFAULT 6 NOT NULL,
	"seller_wallet_address" text NOT NULL,
	"payer_wallet_address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requirements_status_check" CHECK ("payment_requirements"."status" in ('pending', 'submitted', 'verifying', 'confirmed', 'failed', 'expired', 'cancelled', 'consumed')),
	CONSTRAINT "payment_requirements_decimals_check" CHECK ("payment_requirements"."decimals" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_requirement_id" uuid NOT NULL,
	"chain_id" bigint NOT NULL,
	"transaction_hash" text NOT NULL,
	"block_hash" text,
	"block_number" bigint,
	"transaction_index" integer,
	"from_address" text,
	"to_address" text,
	"token_contract_address" text,
	"amount_atomic" numeric(78, 0),
	"confirmation_count" integer DEFAULT 0 NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"failure_code" text,
	"failure_details" jsonb,
	"raw_receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transactions_verification_status_check" CHECK ("payment_transactions"."verification_status" in ('pending', 'verifying', 'confirmed', 'failed', 'reorged'))
);
--> statement-breakpoint
CREATE TABLE "principal_wallets" (
	"principal_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principal_wallets_principal_id_wallet_id_pk" PRIMARY KEY("principal_id","wallet_id"),
	CONSTRAINT "principal_wallets_role_check" CHECK ("principal_wallets"."role" in ('owner', 'agent', 'viewer', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_type_check" CHECK ("principals"."type" in ('dashboard_user', 'autonomous_agent', 'service', 'admin')),
	CONSTRAINT "principals_status_check" CHECK ("principals"."status" in ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_key" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_seconds" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"telemetry_record_id" uuid NOT NULL,
	"payment_requirement_id" uuid NOT NULL,
	"payment_transaction_id" uuid,
	"delivered_at" timestamp with time zone NOT NULL,
	"delivery_status" text DEFAULT 'delivered' NOT NULL,
	"response_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_deliveries_status_check" CHECK ("telemetry_deliveries"."delivery_status" in ('delivered', 'replayed'))
);
--> statement-breakpoint
CREATE TABLE "telemetry_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text,
	"source_observed_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"sequence_number" bigint,
	"schema_version" text NOT NULL,
	"telemetry_payload" jsonb NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"canonicalization_version" text NOT NULL,
	"content_hash_algorithm" text NOT NULL,
	"content_hash" text NOT NULL,
	"anchor_status" text DEFAULT 'unanchored' NOT NULL,
	"anchor_transaction_hash" text,
	"anchor_block_number" bigint,
	"anchor_block_hash" text,
	"anchored_at" timestamp with time zone,
	"data_origin" text DEFAULT 'ENODE_SANDBOX' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_records_anchor_status_check" CHECK ("telemetry_records"."anchor_status" in ('unanchored', 'pending', 'submitted', 'anchored', 'failed')),
	CONSTRAINT "telemetry_records_data_origin_check" CHECK ("telemetry_records"."data_origin" in ('ENODE_SANDBOX', 'ENODE_PRODUCTION'))
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"normalized_address" text NOT NULL,
	"wallet_type" text DEFAULT 'evm' NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_status_check" CHECK ("wallets"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text,
	"dedupe_key" text NOT NULL,
	"event_type" text NOT NULL,
	"signature" text,
	"headers" jsonb NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."processing_status" in ('received', 'queued', 'processing', 'processed', 'unsupported', 'failed', 'dead_letter'))
);
--> statement-breakpoint
ALTER TABLE "agent_device_cursors" ADD CONSTRAINT "agent_device_cursors_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_device_cursors" ADD CONSTRAINT "agent_device_cursors_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_device_cursors" ADD CONSTRAINT "agent_device_cursors_last_delivered_record_id_telemetry_records_id_fk" FOREIGN KEY ("last_delivered_record_id") REFERENCES "public"."telemetry_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_batch_records" ADD CONSTRAINT "anchor_batch_records_batch_id_anchor_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."anchor_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_batch_records" ADD CONSTRAINT "anchor_batch_records_telemetry_record_id_telemetry_records_id_fk" FOREIGN KEY ("telemetry_record_id") REFERENCES "public"."telemetry_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_enode_connection_id_enode_connections_id_fk" FOREIGN KEY ("enode_connection_id") REFERENCES "public"."enode_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enode_connections" ADD CONSTRAINT "enode_connections_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_requirement_id_payment_requirements_id_fk" FOREIGN KEY ("payment_requirement_id") REFERENCES "public"."payment_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requirements" ADD CONSTRAINT "payment_requirements_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requirements" ADD CONSTRAINT "payment_requirements_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requirements" ADD CONSTRAINT "payment_requirements_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requirements" ADD CONSTRAINT "payment_requirements_telemetry_record_id_telemetry_records_id_fk" FOREIGN KEY ("telemetry_record_id") REFERENCES "public"."telemetry_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_requirement_id_payment_requirements_id_fk" FOREIGN KEY ("payment_requirement_id") REFERENCES "public"."payment_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_wallets" ADD CONSTRAINT "principal_wallets_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_wallets" ADD CONSTRAINT "principal_wallets_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_deliveries" ADD CONSTRAINT "telemetry_deliveries_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_deliveries" ADD CONSTRAINT "telemetry_deliveries_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_deliveries" ADD CONSTRAINT "telemetry_deliveries_telemetry_record_id_telemetry_records_id_fk" FOREIGN KEY ("telemetry_record_id") REFERENCES "public"."telemetry_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_deliveries" ADD CONSTRAINT "telemetry_deliveries_payment_requirement_id_payment_requirements_id_fk" FOREIGN KEY ("payment_requirement_id") REFERENCES "public"."payment_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_deliveries" ADD CONSTRAINT "telemetry_deliveries_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_records" ADD CONSTRAINT "telemetry_records_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_device_cursors_device_idx" ON "agent_device_cursors" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anchor_batch_records_telemetry_uidx" ON "anchor_batch_records" USING btree ("telemetry_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anchor_batches_tx_uidx" ON "anchor_batches" USING btree ("chain_id","anchor_transaction_hash") WHERE "anchor_batches"."anchor_transaction_hash" is not null;--> statement-breakpoint
CREATE INDEX "anchor_batches_status_idx" ON "anchor_batches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_credentials_key_hash_uidx" ON "api_credentials" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_credentials_principal_idx" ON "api_credentials" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "api_credentials_prefix_idx" ON "api_credentials" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "audit_logs_principal_created_idx" ON "audit_logs" USING btree ("principal_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_external_device_uidx" ON "devices" USING btree ("external_device_id");--> statement-breakpoint
CREATE INDEX "devices_wallet_idx" ON "devices" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "devices_wallet_status_idx" ON "devices" USING btree ("wallet_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "enode_connections_external_user_uidx" ON "enode_connections" USING btree ("external_user_id");--> statement-breakpoint
CREATE INDEX "enode_connections_wallet_idx" ON "enode_connections" USING btree ("wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_principal_key_uidx" ON "idempotency_records" USING btree ("principal_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_uidx" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_principal_created_idx" ON "ledger_entries" USING btree ("principal_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_claim_idx" ON "outbox_events" USING btree ("status","available_at") WHERE "outbox_events"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requirements_active_uidx" ON "payment_requirements" USING btree ("principal_id","telemetry_record_id","pricing_version") WHERE "payment_requirements"."status" in ('pending', 'submitted', 'verifying', 'confirmed');--> statement-breakpoint
CREATE INDEX "payment_requirements_status_expires_idx" ON "payment_requirements" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_requirements_principal_idx" ON "payment_requirements" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "payment_requirements_telemetry_idx" ON "payment_requirements" USING btree ("telemetry_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_chain_hash_uidx" ON "payment_transactions" USING btree ("chain_id","transaction_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_requirement_uidx" ON "payment_transactions" USING btree ("payment_requirement_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "principal_wallets_wallet_idx" ON "principal_wallets" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "principals_type_status_idx" ON "principals" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_key_window_uidx" ON "rate_limit_buckets" USING btree ("bucket_key","window_started_at");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_updated_idx" ON "rate_limit_buckets" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_deliveries_purchase_uidx" ON "telemetry_deliveries" USING btree ("principal_id","telemetry_record_id","payment_requirement_id");--> statement-breakpoint
CREATE INDEX "telemetry_deliveries_device_idx" ON "telemetry_deliveries" USING btree ("device_id","delivered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_records_content_hash_uidx" ON "telemetry_records" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_records_source_event_uidx" ON "telemetry_records" USING btree ("source","source_event_id") WHERE "telemetry_records"."source_event_id" is not null;--> statement-breakpoint
CREATE INDEX "telemetry_records_latest_by_device_idx" ON "telemetry_records" USING btree ("device_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "telemetry_records_unanchored_idx" ON "telemetry_records" USING btree ("anchor_status","created_at") WHERE "telemetry_records"."anchor_status" in ('unanchored', 'pending', 'submitted');--> statement-breakpoint
CREATE INDEX "telemetry_records_device_recorded_idx" ON "telemetry_records" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_chain_normalized_address_uidx" ON "wallets" USING btree ("chain_id","normalized_address");--> statement-breakpoint
CREATE INDEX "wallets_status_idx" ON "wallets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_dedupe_uidx" ON "webhook_deliveries" USING btree ("provider","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_provider_event_uidx" ON "webhook_deliveries" USING btree ("provider","provider_event_id") WHERE "webhook_deliveries"."provider_event_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("processing_status");