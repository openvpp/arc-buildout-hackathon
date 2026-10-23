import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { VerificationReport } from '@/features/verification/verification-report';
import {
  getPublicEventVerification,
  transactionHashSchema,
} from '@/server/application/verification/public-verification';
import { getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import { ApiError } from '@/server/transport/http/api-error';
import { enforcePublicVerificationLimitsForHeaders } from '@/server/transport/http/verification-limits';

export const metadata: Metadata = { title: 'Record verification' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const log = createServerLogger({ component: 'verify-page' });

const KIND_LABEL = {
  charging_completed: 'Charging session',
  daily_mileage: 'Daily mileage',
  device_event: 'Device event',
} as const;

export default async function VerifyTransactionPage({
  params,
  searchParams,
}: {
  params: Promise<{ txHash: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = transactionHashSchema.safeParse((await params).txHash);
  if (!parsed.success) {
    notFound();
  }
  const refresh = (await searchParams).refresh === '1';

  let limited = false;
  try {
    enforcePublicVerificationLimitsForHeaders(await headers(), refresh);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    limited = true;
  }

  let result: Awaited<ReturnType<typeof getPublicEventVerification>> = null;
  let chainError = false;
  if (!limited) {
    try {
      // Shows the stored verdict. Only a record's first view, or "Re-check
      // now" (its own tight limit), reads the chain; an old verdict queues
      // a background re-check instead.
      result = await getPublicEventVerification(getDb(), {
        transactionHash: parsed.data,
        force: refresh,
      });
    } catch (error) {
      log.warn('verify_page.chain_read_failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      chainError = true;
      result = await getPublicEventVerification(getDb(), {
        transactionHash: parsed.data,
        cachedOnly: true,
      });
    }
  }

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Record verification" description={parsed.data} />
        {limited ? (
          <EmptyState
            title="Too many checks"
            description="This address has run many verifications. Try again in a minute."
          />
        ) : result === null ? (
          <EmptyState
            title="No record from this app has that transaction"
            description="You can still verify any DeviceEvent you hold: POST it to /api/v1/verify or use the standalone script."
          />
        ) : (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-white">
                {KIND_LABEL[result.record.kind]}
              </h2>
              <p className="text-xs text-white/60">
                Activity ended{' '}
                {new Date(result.record.occurredAt).toUTCString()}
                {result.record.tokenId !== null
                  ? ` · DeviceNFT token ${result.record.tokenId}`
                  : ''}
              </p>
            </div>
            {chainError ? (
              <p role="alert" className="text-sm text-amber-300">
                The Arc RPC did not answer just now; showing the last stored
                result.
              </p>
            ) : null}
            {result.recheckQueued ? (
              <p className="text-xs text-white/60">
                This result is a few hours old; a fresh independent check has
                been queued. Reload later to see it.
              </p>
            ) : null}
            <VerificationReport
              verdict={result.verification?.verdict ?? null}
              checks={result.verification?.checks ?? []}
              checkedAt={result.verification?.checkedAt ?? null}
              checkedBy={result.verification?.checkedBy ?? null}
              transactionHash={result.record.transactionHash}
              blockNumber={result.record.blockNumber}
              payloadJson={result.record.payloadJson}
              payloadHash={result.record.payloadHash}
              payloadVersion={result.record.payloadVersion}
              reproduceCommand={result.reproduce.command}
            />
            <div className="flex gap-4 text-sm">
              <Link
                href={`/verify/${parsed.data}?refresh=1`}
                className="text-primary-500 underline"
              >
                Re-check now
              </Link>
              <Link href="/verify" className="text-white/60 underline">
                Verify another record
              </Link>
            </div>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
