CREATE TABLE IF NOT EXISTS "device_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"formatted_address" text NOT NULL,
	"unit" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country_code" text,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"public_latitude" numeric(9, 6) NOT NULL,
	"public_longitude" numeric(9, 6) NOT NULL,
	"geocoder" text DEFAULT 'mapbox' NOT NULL,
	"geocoder_place_id" text,
	"geocoded_permanent" boolean DEFAULT false NOT NULL,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_addresses_coordinates_check" CHECK ("device_addresses"."latitude" between -90 and 90 and "device_addresses"."longitude" between -180 and 180 and "device_addresses"."public_latitude" between -90 and 90 and "device_addresses"."public_longitude" between -180 and 180),
	CONSTRAINT "device_addresses_country_code_check" CHECK ("device_addresses"."country_code" is null or "device_addresses"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "device_addresses_lengths_check" CHECK (char_length("device_addresses"."formatted_address") between 1 and 300 and ("device_addresses"."unit" is null or char_length("device_addresses"."unit") <= 40))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_addresses" ADD CONSTRAINT "device_addresses_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_addresses" ADD CONSTRAINT "device_addresses_updated_by_principal_id_principals_id_fk" FOREIGN KEY ("updated_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_addresses_device_uidx" ON "device_addresses" USING btree ("device_id");