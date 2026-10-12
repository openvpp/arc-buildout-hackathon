import { readFileSync } from 'node:fs';

import { importOvppVehicles } from '@/server/application/import/import-ovpp-vehicles';
import { mapOvppVehicle } from '@/server/application/import/map-ovpp-vehicle';
import { getServerEnv } from '@/server/config/env';
import { closeDb, getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

/**
 * Load an OVPP Mongo vehicles export into Postgres.
 *
 *   pnpm db:import-vehicles -- --file ~/Downloads/backup/ovpp-prod.vehicles.json
 *   pnpm db:import-vehicles -- --file <path> --dry-run
 *
 * The file is read locally and is never written into the repo. Encrypted
 * provider tokens in the export are dropped by the mapper.
 */
async function main(): Promise<void> {
  const logger = createServerLogger({ component: 'import-ovpp-vehicles' });
  const filePath = readFlag('--file');
  const dryRun = process.argv.includes('--dry-run');
  if (filePath === undefined) {
    throw new Error(
      'Pass --file <path> pointing at the OVPP vehicles JSON export.',
    );
  }

  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('Vehicles export must be a JSON array.');
  }

  if (dryRun) {
    let imported = 0;
    let located = 0;
    const skipped: Record<string, number> = {};
    for (const document of parsed) {
      const mapped = mapOvppVehicle(document);
      if (!mapped.ok) {
        skipped[mapped.reason] = (skipped[mapped.reason] ?? 0) + 1;
        continue;
      }
      imported += 1;
      if (mapped.vehicle.latitude !== null) {
        located += 1;
      }
    }
    logger.info('ovpp_vehicle_import_dry_run', {
      read: parsed.length,
      imported,
      located,
      skipped,
    });
    return;
  }

  const env = getServerEnv();
  const db = getDb();
  try {
    const summary = await db.transaction((tx) =>
      importOvppVehicles(tx, {
        documents: parsed,
        chainId: BigInt(env.ARC_CHAIN_ID),
      }),
    );
    logger.info('ovpp_vehicle_import_complete', summary);
  } finally {
    await closeDb();
  }
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

main().catch((error: unknown) => {
  console.error('Vehicle import failed:', error);
  process.exitCode = 1;
});
