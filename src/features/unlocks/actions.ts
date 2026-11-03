'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { formatUsdcAtomic } from '@/lib/payments/usdc';
import { ApplicationError } from '@/server/application/application-error';
import { unlockWithStaticPayer } from '@/server/application/unlocks/event-unlock';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import {
  createConfiguredSeller,
  createStaticPayer,
  resolvePaymentConfig,
} from '@/server/infrastructure/payments/payment-config';

const log = createServerLogger({ component: 'unlock-actions' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UnlockActionState = {
  readonly ok: boolean;
  readonly message: string | null;
};

/** The x402 resource being paid for: this event on the agent data API. */
async function eventResourceUrl(eventId: string): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const proto = requestHeaders.get('x-forwarded-proto') ?? 'https';
  const path = `/api/v1/agent/events/${eventId}`;
  return host === null ? path : `${proto}://${host}${path}`;
}

/**
 * Unlock one of my device's events. The static demo payer pays the
 * nanopayment on Arc through Circle Gateway; nothing is revealed unless
 * Gateway accepts it.
 */
export async function unlockEventAction(
  _previous: UnlockActionState,
  formData: FormData,
): Promise<UnlockActionState> {
  const principal = await getCurrentPrincipal();
  if (principal === null) {
    return { ok: false, message: 'Sign in to unlock events.' };
  }
  const eventId = String(formData.get('eventId') ?? '');
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!UUID.test(eventId) || !UUID.test(deviceId)) {
    return { ok: false, message: 'Unknown event.' };
  }
  const resolved = resolvePaymentConfig();
  if (!resolved.ok) {
    return {
      ok: false,
      message: 'Unlocking is not set up on this deployment yet.',
    };
  }
  const { config } = resolved;
  try {
    const result = await unlockWithStaticPayer({
      db: getDb(),
      eventId,
      buyer: {
        kind: 'owner',
        principalId: principal.principalId,
        walletId: principal.walletId,
      },
      resourceUrl: await eventResourceUrl(eventId),
      config,
      seller: createConfiguredSeller(config.network),
      payer: createStaticPayer(config.network),
    });
    revalidatePath(`/devices/${deviceId}`);
    revalidatePath('/payments');
    revalidatePath('/dashboard');
    if (result.kind !== 'unlocked') {
      return { ok: false, message: 'The event could not be unlocked.' };
    }
    return {
      ok: true,
      message: result.alreadyUnlocked
        ? 'Already unlocked. Nothing was charged.'
        : `Unlocked. Paid ${formatUsdcAtomic(result.unlock.amountAtomic)} USDC on Arc.`,
    };
  } catch (error) {
    if (error instanceof ApplicationError) {
      return { ok: false, message: error.message };
    }
    log.error('unlock.failed', {
      eventId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message:
        'Something went wrong while unlocking. Nothing was revealed; try again.',
    };
  }
}
