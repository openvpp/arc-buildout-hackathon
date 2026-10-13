CREATE TABLE IF NOT EXISTS "dashboard_password_credentials" (
	"principal_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_password_credentials_email_check" CHECK ("dashboard_password_credentials"."email" = lower("dashboard_password_credentials"."email") and char_length("dashboard_password_credentials"."email") between 3 and 320 and position('@' in "dashboard_password_credentials"."email") > 1),
	CONSTRAINT "dashboard_password_credentials_hash_check" CHECK (char_length("dashboard_password_credentials"."password_hash") between 20 and 500)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_password_credentials" ADD CONSTRAINT "dashboard_password_credentials_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_password_credentials_email_uidx" ON "dashboard_password_credentials" USING btree ("email");