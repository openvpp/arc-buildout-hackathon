-- Allow "pending until Arc settlement hash exists" for Circle transfer UUIDs.
ALTER TABLE "agent_verification_results" DROP CONSTRAINT IF EXISTS "agent_verification_results_status_check";
ALTER TABLE "agent_verification_results" ADD CONSTRAINT "agent_verification_results_status_check"
  CHECK (
    "status" in (
      'VERIFIED',
      'TX_MISSING',
      'TX_FAILED',
      'HASH_MISMATCH',
      'ERROR',
      'PENDING_ONCHAIN'
    )
  );
