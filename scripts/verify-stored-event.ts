import { verifyStoredDeviceEvent } from '@/server/application/verification/verify-stored-event';
import { closeDb, getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

/**
 * Operator tool: independently re-verify one stored device event against
 * the chain (same code path as the worker and admin) and print the result.
 *
 *   pnpm verify:event -- <deviceEventId>
 */
async function main(): Promise<void> {
  const logger = createServerLogger({ component: 'verify-stored-event-cli' });
  const deviceEventId = process.argv.slice(2).find((arg) => arg !== '--');
  if (deviceEventId === undefined) {
    throw new Error('Pass the device event id to verify.');
  }
  const result = await verifyStoredDeviceEvent({
    db: getDb(),
    deviceEventId,
    checkedBy: 'cli',
  });
  logger.info('verification.result', {
    deviceEventId,
    verdict: result.verdict,
    checks: result.checks,
    evidence: result.evidence,
  });
}

main()
  .catch((error: unknown) => {
    createServerLogger({ component: 'verify-stored-event-cli' }).error(
      'verification.failed',
      { errorMessage: error instanceof Error ? error.message : String(error) },
    );
    process.exitCode = 1;
  })
  .finally(() => closeDb());
