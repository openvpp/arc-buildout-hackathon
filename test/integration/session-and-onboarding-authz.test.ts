import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { ApplicationError } from '@/server/application/application-error';
import { bindDashboardOwner } from '@/server/application/onboarding/bind-dashboard-owner';
import {
  getPendingConnection,
  onEnodeOAuthComplete,
} from '@/server/application/onboarding/pending-oauth';
import { isDashboardSessionActive } from '@/server/infrastructure/auth/session-authorization';
import {
  pendingDeviceConnections,
  principalWallets,
  principals,
} from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

describe('dashboard session authorization', () => {
  it('accepts an active principal that still owns the wallet', async () => {
    const { principal, wallet } = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    await db.insert(principalWallets).values({
      principalId: principal.id,
      walletId: wallet.id,
      role: 'owner',
    });

    await expect(
      isDashboardSessionActive(db, {
        principalId: principal.id,
        subject: 'owner@example.com',
        walletId: wallet.id,
        walletAddress: wallet.normalizedAddress,
      }),
    ).resolves.toBe(true);
  });

  it('rejects a disabled principal and a wallet the principal does not own', async () => {
    const { principal, wallet } = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    await db
      .update(principals)
      .set({ status: 'disabled' })
      .where(eq(principals.id, principal.id));
    await db.insert(principalWallets).values({
      principalId: principal.id,
      walletId: wallet.id,
      role: 'owner',
    });

    await expect(
      isDashboardSessionActive(db, {
        principalId: principal.id,
        subject: 'disabled@example.com',
        walletId: wallet.id,
        walletAddress: wallet.normalizedAddress,
      }),
    ).resolves.toBe(false);

    const other = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    await expect(
      isDashboardSessionActive(db, {
        principalId: other.principal.id,
        subject: 'other@example.com',
        walletId: wallet.id,
        walletAddress: wallet.normalizedAddress,
      }),
    ).resolves.toBe(false);
  });

  it('refuses to bind a disabled principal before creating a wallet', async () => {
    await db.insert(principals).values({
      type: 'dashboard_user',
      displayName: 'circle:disabled-owner@example.com',
      status: 'disabled',
    });

    await expect(
      bindDashboardOwner(db, { email: 'Disabled-Owner@example.com' }),
    ).rejects.toBeInstanceOf(ApplicationError);
  });
});

describe('pending connection ownership', () => {
  it('does not reveal or mutate another wallet’s pending connection', async () => {
    const owner = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    const stranger = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    const [pending] = await db
      .insert(pendingDeviceConnections)
      .values({
        walletId: owner.wallet.id,
        walletAddress: owner.wallet.address,
        normalizedWalletAddress: owner.wallet.normalizedAddress,
        brand: 'TESLA',
        normalizedBrand: 'TESLA',
        status: 'pending_oauth',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning();
    if (pending === undefined) {
      throw new Error('failed to seed pending connection');
    }

    await expect(
      getPendingConnection(db, {
        id: pending.id,
        walletId: stranger.wallet.id,
      }),
    ).resolves.toBeNull();
    await expect(
      onEnodeOAuthComplete(db, {
        pendingId: pending.id,
        walletId: stranger.wallet.id,
      }),
    ).rejects.toMatchObject({ code: 'PENDING_CONNECTION_NOT_FOUND' });

    const [row] = await db
      .select()
      .from(pendingDeviceConnections)
      .where(eq(pendingDeviceConnections.id, pending.id))
      .limit(1);
    expect(row?.status).toBe('pending_oauth');

    const visible = await getPendingConnection(db, {
      id: pending.id,
      walletId: owner.wallet.id,
    });
    expect(visible?.status).toBe('pending_oauth');
  });
});
