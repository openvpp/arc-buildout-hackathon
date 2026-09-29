import { randomUUID } from 'node:crypto';

import { bindDashboardOwner } from '@/server/application/onboarding/bind-dashboard-owner';
import { closeDb, getDb } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

/**
 * Seeds one demo dashboard owner (a real Circle sandbox wallet, via the
 * same bindDashboardOwner used by sign-in) and one demo Tesla with a known
 * location, so the globe/devices UI can be previewed without a live Enode
 * OEM login. Never marks the device 'minted' — no on-chain mint happened
 * for it, and nothing here should be mistaken for a real device.
 *
 * Sign in at http://localhost:3000 with DEMO_EMAIL to see it.
 */
async function main(): Promise<void> {
  const email = process.env.DEMO_EMAIL ?? 'demo-driver@arc-ev-fleet.dev';
  const db = getDb();

  const owner = await bindDashboardOwner(db, { email });

  const externalDeviceId = `demo-tesla-${randomUUID()}`;
  const [device] = await db
    .insert(devices)
    .values({
      walletId: owner.walletId,
      provider: 'enode',
      externalDeviceId,
      deviceType: 'electric_vehicle',
      vendor: 'TESLA',
      model: 'Model 3',
      displayName: 'Tesla Model 3',
      status: 'active',
      mintStatus: 'pending',
      // Tesla's Fremont factory — a recognizable, real-looking location.
      lastLatitude: '37.492400',
      lastLongitude: '-121.946100',
      lastLocationAt: new Date(),
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [devices.provider, devices.externalDeviceId],
      set: {
        lastLatitude: '37.492400',
        lastLongitude: '-121.946100',
        lastLocationAt: new Date(),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  // eslint-disable-next-line no-console -- CLI script output
  console.log('Demo seed complete.');
  // eslint-disable-next-line no-console -- CLI script output
  console.log(`  Sign in at http://localhost:3000 with: ${email}`);
  // eslint-disable-next-line no-console -- CLI script output
  console.log(`  Wallet address: ${owner.walletAddress}`);
  // eslint-disable-next-line no-console -- CLI script output
  console.log(`  Device: ${device?.displayName} (${device?.id})`);

  await closeDb();
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
