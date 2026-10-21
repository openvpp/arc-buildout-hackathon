import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/common/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { CHECK_LABELS } from '@/features/verification/verdict';
import { transactionHashSchema } from '@/server/application/verification/public-verification';

export const metadata: Metadata = {
  title: 'Verify a record',
  description:
    'Independently confirm a device record is anchored on Arc and unchanged.',
};
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXPLANATIONS: Record<string, string> = {
  anchor_exists:
    'The record is in the stated Arc block, emitted by the DeviceNFT contract.',
  finality: 'The block is deep enough that it can no longer change.',
  authorized_writer:
    "It was written by this app's signer, not some other wallet with write access.",
  device_and_type:
    'It belongs to the right device and is the right kind of record.',
  content_hash:
    'The bytes on-chain hash to exactly what you hold. One changed digit fails.',
  stored_payload: 'The stored copy is byte-identical to the on-chain data.',
  record_commitment:
    'For newer records, the full private record (never published) still matches its salted hash.',
  anchor_timeliness: 'It was anchored soon after the activity, not backdated.',
};

export default async function VerifyLandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tx = (await searchParams).tx;
  const parsed = transactionHashSchema.safeParse(
    typeof tx === 'string' ? tx.trim() : undefined,
  );
  if (parsed.success) {
    redirect(`/verify/${parsed.data}`);
  }
  const invalid = typeof tx === 'string' && tx.length > 0 && !parsed.success;

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader
          title="Verify a record"
          description="Anyone can confirm a device record is anchored on Arc, written by an authorized writer, unchanged, and on time."
        />
        <Card>
          <form
            action="/verify"
            method="get"
            className="flex flex-col gap-3 sm:flex-row"
          >
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="sr-only">Transaction hash</span>
              <input
                name="tx"
                required
                defaultValue={typeof tx === 'string' ? tx : ''}
                placeholder="0x… transaction hash"
                pattern="0x[0-9a-fA-F]{64}"
                className="rounded-md border border-white/15 bg-black px-3 py-2 font-mono text-sm text-white placeholder:text-white/40 focus:border-primary-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-primary-500 px-4 py-2 text-sm font-medium text-primary-500 hover:bg-primary-500/10"
            >
              Verify
            </button>
          </form>
          {invalid ? (
            <p role="alert" className="mt-2 text-sm text-red-300">
              Enter a 0x-prefixed, 64-character transaction hash.
            </p>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-3">
          <CardTitle>What “verified” means</CardTitle>
          <ul className="flex flex-col gap-2 text-sm">
            {Object.entries(EXPLANATIONS).map(([id, text]) => (
              <li key={id}>
                <span className="font-medium text-white/90">
                  {CHECK_LABELS[id]}.
                </span>{' '}
                <span className="text-white/60">{text}</span>
              </li>
            ))}
          </ul>
          <CardDescription>
            It proves the record is tamper-evident and attributable. It does not
            prove the vehicle&apos;s measurement itself was correct.
          </CardDescription>
        </Card>

        <Card className="flex flex-col gap-2 text-sm text-white/70">
          <CardTitle>Don&apos;t trust this site</CardTitle>
          <p>
            Every check uses only public chain data. Read the{' '}
            <Link
              href="/api/v1/verify/spec"
              className="text-primary-500 underline"
            >
              machine-readable spec
            </Link>
            , POST your own record to{' '}
            <code className="font-mono text-white/80">/api/v1/verify</code>, or
            run the standalone script against any Arc RPC:
          </p>
          <pre className="overflow-x-auto rounded-md bg-black/60 p-3 font-mono text-xs text-white/80">
            pnpm verify:standalone -- --rpc &lt;arc-rpc&gt; --contract
            &lt;address&gt;
            {'\n'} --tx &lt;hash&gt; --block &lt;number&gt; --payload
            &apos;&lt;json&gt;&apos;
          </pre>
        </Card>
      </div>
    </PageContainer>
  );
}
