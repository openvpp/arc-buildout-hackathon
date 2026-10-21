CREATE TABLE IF NOT EXISTS "admin_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_accounts_hash_check" CHECK (char_length("admin_accounts"."password_hash") between 20 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_accounts_username_uidx" ON "admin_accounts" USING btree ("username");