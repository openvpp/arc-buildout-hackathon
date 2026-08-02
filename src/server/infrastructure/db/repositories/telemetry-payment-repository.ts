import { and, desc, eq, sql } from 'drizzle-orm';

import type { NormalizedTelemetryData } from '@/server/domain/telemetry/canonical';
import type { Database } from '@/server/infrastructure/db/client';
import {
  agentDeviceCursors,
  devices,
  ledgerEntries,
  paymentRequirements,
  paymentTransactions,
  principalWallets,
  telemetryDeliveries,
  telemetryRecords,
  wallets,
  webhookDeliveries,
} from '@/server/infrastructure/db/schema';
import type { DbOrTx } from '@/server/infrastructure/db/transaction';

export type TelemetryRecordRow = typeof telemetryRecords.$inferSelect;

export async function findDeviceById(db: DbOrTx, deviceId: string) {
  const [row] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return row ?? null;
}

export async function findDeviceByExternalId(
  db: DbOrTx,
  externalDeviceId: string,
) {
  const [row] = await db
    .select()
    .from(devices)
    .where(eq(devices.externalDeviceId, externalDeviceId))
    .limit(1);
  return row ?? null;
}

export async function findWalletByNormalizedAddress(
  db: DbOrTx,
  chainId: bigint,
  normalizedAddress: string,
) {
  const [row] = await db
    .select()
    .from(wallets)
    .where(
      and(
        eq(wallets.chainId, chainId),
        eq(wallets.normalizedAddress, normalizedAddress),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function principalHasWalletAccess(
  db: DbOrTx,
  principalId: string,
  walletId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(principalWallets)
    .where(
      and(
        eq(principalWallets.principalId, principalId),
        eq(principalWallets.walletId, walletId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function findLatestTelemetryForDevice(
  db: DbOrTx,
  deviceId: string,
): Promise<TelemetryRecordRow | null> {
  const [row] = await db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.deviceId, deviceId))
    .orderBy(desc(telemetryRecords.recordedAt), desc(telemetryRecords.id))
    .limit(1);
  return row ?? null;
}

export async function getAgentCursor(
  db: DbOrTx,
  principalId: string,
  deviceId: string,
) {
  const [row] = await db
    .select()
    .from(agentDeviceCursors)
    .where(
      and(
        eq(agentDeviceCursors.principalId, principalId),
        eq(agentDeviceCursors.deviceId, deviceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findDeliveryForPurchase(
  db: DbOrTx,
  principalId: string,
  telemetryRecordId: string,
) {
  const [row] = await db
    .select()
    .from(telemetryDeliveries)
    .where(
      and(
        eq(telemetryDeliveries.principalId, principalId),
        eq(telemetryDeliveries.telemetryRecordId, telemetryRecordId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findActivePaymentRequirement(
  db: DbOrTx,
  principalId: string,
  telemetryRecordId: string,
  pricingVersion: string,
) {
  const [row] = await db
    .select()
    .from(paymentRequirements)
    .where(
      and(
        eq(paymentRequirements.principalId, principalId),
        eq(paymentRequirements.telemetryRecordId, telemetryRecordId),
        eq(paymentRequirements.pricingVersion, pricingVersion),
        sql`${paymentRequirements.status} in ('pending', 'submitted', 'verifying', 'confirmed')`,
        sql`${paymentRequirements.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertPaymentRequirement(
  db: DbOrTx,
  values: typeof paymentRequirements.$inferInsert,
) {
  const [row] = await db.insert(paymentRequirements).values(values).returning();
  if (row === undefined)
    throw new Error('Failed to insert payment requirement');
  return row;
}

export async function insertTelemetryRecord(
  db: DbOrTx,
  values: typeof telemetryRecords.$inferInsert,
) {
  const [row] = await db.insert(telemetryRecords).values(values).returning();
  if (row === undefined) throw new Error('Failed to insert telemetry record');
  return row;
}

export async function insertWebhookDelivery(
  db: Database,
  values: typeof webhookDeliveries.$inferInsert,
) {
  const [row] = await db.insert(webhookDeliveries).values(values).returning();
  if (row === undefined) throw new Error('Failed to insert webhook delivery');
  return row;
}

export async function creditAndDeliver(input: {
  db: Database;
  principalId: string;
  walletId: string;
  deviceId: string;
  telemetryRecordId: string;
  paymentRequirementId: string;
  chainId: bigint;
  amountAtomic: string;
  asset: string;
  transactionHash: string;
  payerAddress: string;
  tokenContractAddress: string;
}): Promise<{
  deliveryId: string;
  paymentTransactionId: string;
}> {
  return input.db.transaction(async (tx) => {
    await tx.execute(sql`
      select id from payment_requirements
      where id = ${input.paymentRequirementId}
      for update
    `);

    const [requirement] = await tx
      .select()
      .from(paymentRequirements)
      .where(eq(paymentRequirements.id, input.paymentRequirementId))
      .limit(1);

    if (requirement === undefined) {
      throw new Error('Payment requirement not found');
    }

    const existingDelivery = await findDeliveryForPurchase(
      tx,
      input.principalId,
      input.telemetryRecordId,
    );
    if (existingDelivery !== null) {
      return {
        deliveryId: existingDelivery.id,
        paymentTransactionId: existingDelivery.paymentTransactionId ?? '',
      };
    }

    const [paymentTx] = await tx
      .insert(paymentTransactions)
      .values({
        paymentRequirementId: input.paymentRequirementId,
        chainId: input.chainId,
        transactionHash: input.transactionHash,
        fromAddress: input.payerAddress,
        toAddress: requirement.sellerWalletAddress,
        tokenContractAddress: input.tokenContractAddress,
        amountAtomic: input.amountAtomic,
        confirmationCount: 1,
        verificationStatus: 'confirmed',
        verifiedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    let paymentTransactionId = paymentTx?.id;
    if (paymentTransactionId === undefined) {
      const [existing] = await tx
        .select()
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.chainId, input.chainId),
            eq(paymentTransactions.transactionHash, input.transactionHash),
          ),
        )
        .limit(1);
      if (existing === undefined) {
        throw new Error('Failed to claim payment transaction');
      }
      paymentTransactionId = existing.id;
    }

    await tx
      .update(paymentRequirements)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(eq(paymentRequirements.id, input.paymentRequirementId));

    await tx
      .insert(ledgerEntries)
      .values({
        principalId: input.principalId,
        walletId: input.walletId,
        paymentRequirementId: input.paymentRequirementId,
        paymentTransactionId,
        entryType: 'payment_credit',
        amountAtomic: input.amountAtomic,
        asset: input.asset,
        chainId: input.chainId,
        idempotencyKey: `payment_credit:${input.paymentRequirementId}`,
      })
      .onConflictDoNothing();

    await tx
      .insert(ledgerEntries)
      .values({
        principalId: input.principalId,
        walletId: input.walletId,
        paymentRequirementId: input.paymentRequirementId,
        paymentTransactionId,
        entryType: 'telemetry_charge',
        amountAtomic: input.amountAtomic,
        asset: input.asset,
        chainId: input.chainId,
        idempotencyKey: `telemetry_charge:${input.paymentRequirementId}`,
      })
      .onConflictDoNothing();

    const [delivery] = await tx
      .insert(telemetryDeliveries)
      .values({
        principalId: input.principalId,
        deviceId: input.deviceId,
        telemetryRecordId: input.telemetryRecordId,
        paymentRequirementId: input.paymentRequirementId,
        paymentTransactionId,
        deliveredAt: new Date(),
        deliveryStatus: 'delivered',
      })
      .onConflictDoNothing()
      .returning();

    let deliveryId = delivery?.id;
    if (deliveryId === undefined) {
      const existing = await findDeliveryForPurchase(
        tx,
        input.principalId,
        input.telemetryRecordId,
      );
      if (existing === null) {
        throw new Error('Failed to create telemetry delivery');
      }
      deliveryId = existing.id;
    }

    await tx
      .insert(agentDeviceCursors)
      .values({
        principalId: input.principalId,
        deviceId: input.deviceId,
        lastDeliveredRecordId: input.telemetryRecordId,
        lastDeliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [agentDeviceCursors.principalId, agentDeviceCursors.deviceId],
        set: {
          lastDeliveredRecordId: input.telemetryRecordId,
          lastDeliveredAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await tx
      .update(paymentRequirements)
      .set({ status: 'consumed', updatedAt: new Date() })
      .where(eq(paymentRequirements.id, input.paymentRequirementId));

    return { deliveryId, paymentTransactionId };
  });
}

export function telemetryPayloadAsData(
  payload: Record<string, unknown>,
): NormalizedTelemetryData {
  return {
    stateOfChargePercent:
      typeof payload['stateOfChargePercent'] === 'number'
        ? payload['stateOfChargePercent']
        : null,
    isCharging:
      typeof payload['isCharging'] === 'boolean' ? payload['isCharging'] : null,
    isPluggedIn:
      typeof payload['isPluggedIn'] === 'boolean'
        ? payload['isPluggedIn']
        : null,
    rangeKilometers:
      typeof payload['rangeKilometers'] === 'number'
        ? payload['rangeKilometers']
        : null,
    odometerKilometers:
      typeof payload['odometerKilometers'] === 'number'
        ? payload['odometerKilometers']
        : null,
    chargeRateKilowatts:
      typeof payload['chargeRateKilowatts'] === 'number'
        ? payload['chargeRateKilowatts']
        : null,
    powerKilowatts:
      typeof payload['powerKilowatts'] === 'number'
        ? payload['powerKilowatts']
        : null,
    latitude:
      typeof payload['latitude'] === 'number' ? payload['latitude'] : null,
    longitude:
      typeof payload['longitude'] === 'number' ? payload['longitude'] : null,
  };
}
