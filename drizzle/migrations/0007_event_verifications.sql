CREATE TABLE IF NOT EXISTS "event_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_event_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"checks" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"checked_by" text NOT NULL,
	"rpc_host" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_verifications_verdict_check" CHECK ("event_verifications"."verdict" in ('pending', 'verified', 'verified_with_warnings', 'unverified'))
);
--> statement-breakpoint
ALTER TABLE "device_events" ADD COLUMN "verification_status" text DEFAULT 'unchecked' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_events" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_verifications" ADD CONSTRAINT "event_verifications_device_event_id_device_events_id_fk" FOREIGN KEY ("device_event_id") REFERENCES "public"."device_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_verifications_event_checked_idx" ON "event_verifications" USING btree ("device_event_id","checked_at");--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_verification_status_check" CHECK ("device_events"."verification_status" in ('unchecked', 'pending', 'verified', 'verified_with_warnings', 'unverified'));