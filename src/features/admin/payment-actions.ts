'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { formatUsdcAtomic, parseUsdcToAtomic } from '@/lib/payments/usdc';
import {
  confirmedEventOnDevice,
  unpaidAnchoredEventIds,
} from '@/server/application/admin/admin-payments';
import { ApplicationError } from '@/server/application/application-error';
import { unlockWithStaticPayer } from '@/server/application/unlocks/event-unlock';
import type { Database } from '@/server/infrastructure/db/client';
import { getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import {
  createConfiguredSeller,
  createStaticPayer,
  resolvePaymentConfig,
  type PaymentConfig,
} from '@/server/infrastructure/payments/payment-config';

import type { AdminActionState } from './actions';
import { requireAdminSession } from './server';

const log = createServerLogger({ component: 'admin-payment-actions' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Fetch telemetry (paid)" buys at most this many events per click (each is one Gateway settle inside the request, so keep it small). */
const FETCH_LIMIT = 10;
/** One deposit may move at most this much USDC into Gateway. */
const MAX_DEPOSIT_ATOMIC = parseUsdcToAtomic('10');

function failed(message: string): AdminActionState {
  return { ok: false, message };
}

async function origin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const proto = requestHeaders.get('x-forwarded-proto') ?? 'https';
  return host === null ? '' : `${proto}://${host}`;
}

/**
 * Fetch a device's telemetry the paid way: the static demo payer pays a
 * nanopayment for each anchored event the admin has not bought yet.
 */
export async function fetchPaidTelemetryAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const session = await requireAdminSession();
  if (!session.ok)
    return failed('Your admin session has ended. Sign in again.');
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!UUID.test(deviceId)) return failed('Unknown device.');
  const resolved = resolvePaymentConfig();
  if (!resolved.ok) return failed('Payments are not configured here.');
  const eventIds = await unpaidAnchoredEventIds(getDb(), deviceId, FETCH_LIMIT);
  if (eventIds.length === 0) {
    return { ok: true, message: 'Every anchored event is already paid for.' };
  }
  return payForEvents({
    deviceId,
    eventIds,
    config: resolved.config,
    requestedBy: `admin:${session.admin.username}`,
  });
}

/**
 * Pay for one anchored record. Same Gateway path as the device-wide fetch,
 * scoped to the event on this page.
 */
export async function fetchPaidRecordAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const session = await requireAdminSession();
  if (!session.ok)
    return failed('Your admin session has ended. Sign in again.');
  const deviceId = String(formData.get('deviceId') ?? '');
  const deviceEventId = String(formData.get('deviceEventId') ?? '');
  if (!UUID.test(deviceId) || !UUID.test(deviceEventId)) {
    return failed('Unknown record.');
  }
  const resolved = resolvePaymentConfig();
  if (!resolved.ok) return failed('Payments are not configured here.');
  const onDevice = await confirmedEventOnDevice(
    getDb(),
    deviceId,
    deviceEventId,
  );
  if (!onDevice) {
    return failed('This record is not an anchored event on this device.');
  }
  return payForEvents({
    deviceId,
    eventIds: [deviceEventId],
    config: resolved.config,
    requestedBy: `admin:${session.admin.username}`,
  });
}

/** Settle one nanopayment per event. Stops at the first failure. */
async function payForEvents(input: {
  deviceId: string;
  eventIds: readonly string[];
  config: PaymentConfig;
  requestedBy: string;
}): Promise<AdminActionState> {
  const db: Database = getDb();
  const seller = createConfiguredSeller(input.config.network);
  const payer = createStaticPayer(input.config.network);
  const base = await origin();
  let paid = 0;
  let alreadyUnlocked = false;
  for (const eventId of input.eventIds) {
    try {
      const result = await unlockWithStaticPayer({
        db,
        eventId,
        buyer: { kind: 'admin' },
        resourceUrl: `${base}/api/v1/agent/events/${eventId}`,
        config: input.config,
        seller,
        payer,
      });
      if (result.kind === 'unlocked' && result.alreadyUnlocked) {
        alreadyUnlocked = true;
      } else if (result.kind === 'unlocked') {
        paid += 1;
      }
    } catch (error) {
      revalidatePath(`/admin/devices/${input.deviceId}`);
      revalidatePath('/admin/payments');
      if (error instanceof ApplicationError) {
        return failed(
          `${paid > 0 ? `Paid for ${paid} event(s), then stopped: ` : ''}${error.message}`,
        );
      }
      log.error('admin.fetch_paid_failed', {
        deviceId: input.deviceId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return failed('The payment flow failed. Nothing more was paid.');
    }
  }
  log.info('admin.fetch_paid', {
    deviceId: input.deviceId,
    paid,
    requestedBy: input.requestedBy,
  });
  revalidatePath(`/admin/devices/${input.deviceId}`);
  revalidatePath('/admin/payments');
  if (paid === 0 && alreadyUnlocked) {
    return {
      ok: true,
      message: 'This record is already paid for. Nothing was charged.',
    };
  }
  return {
    ok: true,
    message: `Paid ${formatUsdcAtomic(input.config.unlockPriceAtomic * BigInt(paid))} USDC for ${paid} event(s) through Circle Gateway.`,
  };
}

/**
 * Move USDC from the static payer's wallet into Circle Gateway: an
 * on-chain transaction. The form requires an explicit confirmation box.
 */
export async function depositToGatewayAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const session = await requireAdminSession();
  if (!session.ok)
    return failed('Your admin session has ended. Sign in again.');
  if (formData.get('confirm') !== 'yes') {
    return failed('Tick the box to confirm this on-chain deposit.');
  }
  let amountAtomic: bigint;
  try {
    amountAtomic = parseUsdcToAtomic(String(formData.get('amount') ?? ''));
  } catch {
    return failed('Enter an amount in USDC, e.g. 1 or 0.5.');
  }
  if (amountAtomic <= 0n || amountAtomic > MAX_DEPOSIT_ATOMIC) {
    return failed(
      `Deposit between 0.000001 and ${formatUsdcAtomic(MAX_DEPOSIT_ATOMIC)} USDC.`,
    );
  }
  const resolved = resolvePaymentConfig();
  if (!resolved.ok) return failed('Payments are not configured here.');
  const payer = createStaticPayer(resolved.config.network);
  if (payer === null) return failed('No demo payer is configured here.');
  try {
    const balances = await payer.getBalances();
    // USDC's ERC-20 balance (6 decimals), the same units as the deposit.
    const walletAtomic = balances.walletAtomic;
    if (walletAtomic < amountAtomic) {
      return failed(
        `The payer wallet holds ${formatUsdcAtomic(walletAtomic)} USDC. Fund ${payer.address} from https://faucet.circle.com first.`,
      );
    }
    const { depositTxHash } = await payer.deposit(amountAtomic);
    log.info('admin.gateway_deposit', {
      amountAtomic: amountAtomic.toString(),
      depositTxHash,
      requestedBy: `admin:${session.admin.username}`,
    });
    revalidatePath('/admin/payments');
    return {
      ok: true,
      message: `Deposited ${formatUsdcAtomic(amountAtomic)} USDC into Gateway (tx ${depositTxHash}).`,
    };
  } catch (error) {
    log.error('admin.gateway_deposit_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return failed(
      'The deposit did not go through. Check the payer wallet and try again.',
    );
  }
}
