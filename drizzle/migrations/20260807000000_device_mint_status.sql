ALTER TABLE "devices" ADD COLUMN "mint_status" text DEFAULT 'unminted' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "mint_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_mint_status_check" CHECK ("devices"."mint_status" in ('unminted', 'pending', 'minted', 'failed'));--> statement-breakpoint
UPDATE "devices" SET "mint_status" = 'minted' WHERE "nft_token_id" IS NOT NULL AND "nft_token_id" <> '';
