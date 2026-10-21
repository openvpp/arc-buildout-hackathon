ALTER TABLE "device_events" ADD COLUMN "payload_version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_events" ADD COLUMN "record_json" text;--> statement-breakpoint
ALTER TABLE "device_events" ADD COLUMN "record_salt" text;--> statement-breakpoint
ALTER TABLE "device_events" ADD COLUMN "record_hash" text;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_record_commitment_check" CHECK (("device_events"."payload_version" = 1 and "device_events"."record_hash" is null and "device_events"."record_salt" is null and "device_events"."record_json" is null) or ("device_events"."payload_version" = 2 and "device_events"."record_hash" is not null and "device_events"."record_salt" is not null and "device_events"."record_json" is not null));