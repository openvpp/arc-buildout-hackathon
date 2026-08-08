import { desc, eq } from 'drizzle-orm';

import { MAX_PAGE_SIZE } from '@/server/config/constants';
import type { Database } from '@/server/infrastructure/db/client';
import {
  devices,
  paymentRequirements,
  paymentTransactions,
  principals,
  wallets,
} from '@/server/infrastructure/db/schema';

/** Bounded recent payments list for the Super Admin overview. */
export const ADMIN_PAYMENTS_LIMIT = 50;

export type AdminPaymentRow = {
  readonly id: string;
  readonly transactionHash: string;
  readonly verificationStatus: string;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
  readonly fromAddress: string | null;
  readonly toAddress: string | null;
  readonly amountDisplay: string;
  readonly asset: string;
  readonly requirementStatus: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly walletAddress: string;
  readonly walletLabel: string | null;
  readonly principalDisplayName: string;
};

/**
 * Recent settled nanopayments across tenants (from payment_transactions).
 * Joins requirement + device + wallet + principal for admin display.
 */
export async function listRecentAdminPayments(
  db: Database,
  limit: number = ADMIN_PAYMENTS_LIMIT,
): Promise<AdminPaymentRow[]> {
  const take = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);

  const rows = await db
    .select({
      id: paymentTransactions.id,
      transactionHash: paymentTransactions.transactionHash,
      verificationStatus: paymentTransactions.verificationStatus,
      verifiedAt: paymentTransactions.verifiedAt,
      createdAt: paymentTransactions.createdAt,
      fromAddress: paymentTransactions.fromAddress,
      toAddress: paymentTransactions.toAddress,
      amountDisplay: paymentRequirements.amountDisplay,
      asset: paymentRequirements.asset,
      requirementStatus: paymentRequirements.status,
      deviceId: devices.id,
      deviceDisplayName: devices.displayName,
      externalDeviceId: devices.externalDeviceId,
      walletAddress: wallets.address,
      walletLabel: wallets.label,
      principalDisplayName: principals.displayName,
    })
    .from(paymentTransactions)
    .innerJoin(
      paymentRequirements,
      eq(paymentRequirements.id, paymentTransactions.paymentRequirementId),
    )
    .innerJoin(devices, eq(devices.id, paymentRequirements.deviceId))
    .innerJoin(wallets, eq(wallets.id, paymentRequirements.walletId))
    .innerJoin(principals, eq(principals.id, paymentRequirements.principalId))
    .orderBy(desc(paymentTransactions.createdAt))
    .limit(take);

  return rows.map((row) => ({
    id: row.id,
    transactionHash: row.transactionHash,
    verificationStatus: row.verificationStatus,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    amountDisplay: row.amountDisplay,
    asset: row.asset,
    requirementStatus: row.requirementStatus,
    deviceId: row.deviceId,
    deviceLabel: row.deviceDisplayName ?? row.externalDeviceId,
    walletAddress: row.walletAddress,
    walletLabel: row.walletLabel,
    principalDisplayName: row.principalDisplayName,
  }));
}
