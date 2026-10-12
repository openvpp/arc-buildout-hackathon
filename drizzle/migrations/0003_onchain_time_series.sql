CREATE TABLE IF NOT EXISTS "charging_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"start_battery_level" numeric(5, 2),
	"end_battery_level" numeric(5, 2),
	"battery_capacity_kwh" numeric(7, 3),
	"energy_delivered_kwh" numeric(10, 4) DEFAULT '0' NOT NULL,
	"energy_method" text DEFAULT 'unknown' NOT NULL,
	"electricity_price" numeric(10, 4),
	"total_cost" numeric(12, 4),
	"currency" text DEFAULT 'USD' NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"last_provider_update_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charging_sessions_status_check" CHECK ("charging_sessions"."status" in ('active', 'completed', 'cancelled')),
	CONSTRAINT "charging_sessions_energy_method_check" CHECK ("charging_sessions"."energy_method" in ('direct_kwh', 'estimated_from_battery_change', 'unknown')),
	CONSTRAINT "charging_sessions_battery_range_check" CHECK (("charging_sessions"."start_battery_level" is null or "charging_sessions"."start_battery_level" between 0 and 100) and ("charging_sessions"."end_battery_level" is null or "charging_sessions"."end_battery_level" between 0 and 100)),
	CONSTRAINT "charging_sessions_non_negative_check" CHECK ("charging_sessions"."energy_delivered_kwh" >= 0 and ("charging_sessions"."electricity_price" is null or "charging_sessions"."electricity_price" >= 0) and ("charging_sessions"."total_cost" is null or "charging_sessions"."total_cost" >= 0)),
	CONSTRAINT "charging_sessions_end_after_start_check" CHECK ("charging_sessions"."end_time" is null or "charging_sessions"."end_time" >= "charging_sessions"."start_time"),
	CONSTRAINT "charging_sessions_closed_has_end_check" CHECK ("charging_sessions"."status" = 'active' or "charging_sessions"."end_time" is not null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_odometer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"date_utc" date NOT NULL,
	"start_odometer_km" numeric(12, 3) NOT NULL,
	"end_odometer_km" numeric(12, 3) NOT NULL,
	"start_estimated" boolean DEFAULT false NOT NULL,
	"reading_count" bigint DEFAULT 0 NOT NULL,
	"anomaly_count" bigint DEFAULT 0 NOT NULL,
	"last_reading_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_odometer_status_check" CHECK ("daily_odometer"."status" in ('open', 'finalized')),
	CONSTRAINT "daily_odometer_monotonic_check" CHECK ("daily_odometer"."start_odometer_km" >= 0 and "daily_odometer"."end_odometer_km" >= "daily_odometer"."start_odometer_km"),
	CONSTRAINT "daily_odometer_finalized_at_check" CHECK ("daily_odometer"."status" = 'open' or "daily_odometer"."finalized_at" is not null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"event_type" smallint NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_json" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"claimed_at" timestamp with time zone,
	"chain_id" bigint,
	"contract_address" text,
	"token_id" text,
	"transaction_hash" text,
	"block_number" bigint,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_events_event_type_check" CHECK ("device_events"."event_type" in (2, 12)),
	CONSTRAINT "device_events_source_type_check" CHECK ("device_events"."source_type" in ('charging_session', 'daily_odometer')),
	CONSTRAINT "device_events_source_matches_type_check" CHECK (("device_events"."source_type" = 'charging_session' and "device_events"."event_type" = 2) or ("device_events"."source_type" = 'daily_odometer' and "device_events"."event_type" = 12)),
	CONSTRAINT "device_events_status_check" CHECK ("device_events"."status" in ('queued', 'pending', 'confirmed', 'failed')),
	CONSTRAINT "device_events_confirmed_has_tx_check" CHECK ("device_events"."status" <> 'confirmed' or ("device_events"."transaction_hash" is not null and "device_events"."token_id" is not null and "device_events"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "odometer_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"odometer_km" numeric(12, 3) NOT NULL,
	"webhook_delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odometer_readings_non_negative_check" CHECK ("odometer_readings"."odometer_km" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_odometer" ADD CONSTRAINT "daily_odometer_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_webhook_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("webhook_delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "charging_sessions_session_id_uidx" ON "charging_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "charging_sessions_one_active_uidx" ON "charging_sessions" USING btree ("device_id") WHERE "charging_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charging_sessions_device_start_idx" ON "charging_sessions" USING btree ("device_id","start_time","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_odometer_device_date_uidx" ON "daily_odometer" USING btree ("device_id","date_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_odometer_open_date_idx" ON "daily_odometer" USING btree ("date_utc") WHERE "daily_odometer"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_events_source_uidx" ON "device_events" USING btree ("source_type","source_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_events_transaction_hash_uidx" ON "device_events" USING btree ("transaction_hash") WHERE "device_events"."transaction_hash" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_events_device_occurred_idx" ON "device_events" USING btree ("device_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "odometer_readings_device_observed_uidx" ON "odometer_readings" USING btree ("device_id","observed_at");