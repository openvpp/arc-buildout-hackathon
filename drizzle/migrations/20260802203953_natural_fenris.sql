CREATE TABLE "agent_verification_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"telemetry_record_id" uuid NOT NULL,
	"payment_transaction_hash" text NOT NULL,
	"status" text NOT NULL,
	"receipt_found" boolean DEFAULT false NOT NULL,
	"receipt_success" boolean DEFAULT false NOT NULL,
	"content_hash_expected" text NOT NULL,
	"content_hash_computed" text NOT NULL,
	"content_hash_matched" boolean DEFAULT false NOT NULL,
	"details" jsonb,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_verification_results_status_check" CHECK ("agent_verification_results"."status" in ('VERIFIED', 'TX_MISSING', 'TX_FAILED', 'HASH_MISMATCH', 'ERROR'))
);
--> statement-breakpoint
ALTER TABLE "agent_verification_results" ADD CONSTRAINT "agent_verification_results_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_verification_results" ADD CONSTRAINT "agent_verification_results_telemetry_record_id_telemetry_records_id_fk" FOREIGN KEY ("telemetry_record_id") REFERENCES "public"."telemetry_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_verification_results_unique_uidx" ON "agent_verification_results" USING btree ("principal_id","telemetry_record_id","payment_transaction_hash");--> statement-breakpoint
CREATE INDEX "agent_verification_results_telemetry_idx" ON "agent_verification_results" USING btree ("telemetry_record_id");