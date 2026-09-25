import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { mintDeviceNftIfNeeded } from '@/server/application/onboarding/mint-device-nft';
import { devices } from '@/server/infrastructure/db/schema';
import type { DeviceNftMinter } from '@/server/infrastructure/blockchain/device-nft';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

function makeFakeMinter(): DeviceNftMinter & { callCount: number } {
  const minter = {
    callCount: 0,
    async mintDevice(input: {
      to: string;
      typeId: bigint;
      deviceURI: string;
      onBroadcast: (hash: string) => Promise<void>;
    }) {
      minter.callCount += 1;
      const hash = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(24)}`;
      await input.onBroadcast(hash);
      // Widen the race window so a genuinely concurrent second call would
      // observe the claim, not a finished mint.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { tokenId: '42', transactionHash: hash };
    },
    async reconcileMint() {
      return null;
    },
  };
  return minter;
}

async function seedDevice() {
  const { wallet } = await insertTestWallet(db, {
    address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    circleWalletId: randomUUID(),
  });
  const [device] = await db
    .insert(devices)
    .values({
      walletId: wallet.id,
      provider: 'enode',
      externalDeviceId: randomUUID(),
      deviceType: 'vehicle',
    })
    .returning();
  if (device === undefined) {
    throw new Error('failed to seed device');
  }
  return device;
}

describe('mintDeviceNftIfNeeded concurrency (claim-before-mint)', () => {
  it('only one concurrent caller wins the claim and mints once', async () => {
    const device = await seedDevice();
    const minter = makeFakeMinter();

    const [first, second] = await Promise.all([
      mintDeviceNftIfNeeded({
        db,
        deviceId: device.id,
        minterOverride: minter,
      }),
      mintDeviceNftIfNeeded({
        db,
        deviceId: device.id,
        minterOverride: minter,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['busy', 'minted']);
    expect(minter.callCount).toBe(1);

    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, device.id))
      .limit(1);
    expect(row?.mintStatus).toBe('minted');
    expect(row?.nftTokenId).toBe('42');
  });

  it('is idempotent when called again after a successful mint', async () => {
    const device = await seedDevice();
    const minter = makeFakeMinter();

    await mintDeviceNftIfNeeded({
      db,
      deviceId: device.id,
      minterOverride: minter,
    });
    const again = await mintDeviceNftIfNeeded({
      db,
      deviceId: device.id,
      minterOverride: minter,
    });

    expect(again).toEqual({ status: 'already_minted', tokenId: '42' });
    expect(minter.callCount).toBe(1);
  });

  it('marks unconfigured (never fakes a mint) when no minter is available', async () => {
    const device = await seedDevice();
    const result = await mintDeviceNftIfNeeded({
      db,
      deviceId: device.id,
      minterOverride: null,
    });
    expect(result).toEqual({ status: 'unconfigured' });

    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, device.id))
      .limit(1);
    expect(row?.mintStatus).toBe('unminted');
    expect(row?.nftTokenId).toBeNull();
  });
});
