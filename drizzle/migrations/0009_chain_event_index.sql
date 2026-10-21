CREATE TABLE IF NOT EXISTS "chain_device_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_address" text NOT NULL,
	"token_id" text NOT NULL,
	"event_type" smallint NOT NULL,
	"transaction_hash" text NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" bigint NOT NULL,
	"data_hash" text NOT NULL,
	"payload_utf8" text,
	"block_timestamp" timestamp with time zone,
	"discovered_via" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_device_events_discovered_via_check" CHECK ("chain_device_events"."discovered_via" in ('scan', 'explorer'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chain_scan_cursors" (
	"chain_id" bigint NOT NULL,
	"contract_address" text NOT NULL,
	"last_scanned_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_scan_cursors_chain_id_contract_address_pk" PRIMARY KEY("chain_id","contract_address")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chain_device_events_log_uidx" ON "chain_device_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chain_device_events_token_idx" ON "chain_device_events" USING btree ("chain_id","contract_address","token_id","block_number");