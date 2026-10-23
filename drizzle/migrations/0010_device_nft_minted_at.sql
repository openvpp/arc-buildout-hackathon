ALTER TABLE "devices" ADD COLUMN "nft_minted_at" timestamp with time zone;--> statement-breakpoint
-- Backfill from the mint job that completed the device's mint, where one
-- exists. Devices minted any other way keep null (lateness then counts
-- from the activity itself).
UPDATE "devices" AS d
SET "nft_minted_at" = o.processed_at
FROM (
	SELECT aggregate_id, max(processed_at) AS processed_at
	FROM "outbox_events"
	WHERE event_type = 'MINT_DEVICE_NFT'
		AND aggregate_type = 'device'
		AND status = 'completed'
		AND processed_at IS NOT NULL
	GROUP BY aggregate_id
) AS o
WHERE d.id::text = o.aggregate_id
	AND d.mint_status = 'minted'
	AND d.nft_minted_at IS NULL;
