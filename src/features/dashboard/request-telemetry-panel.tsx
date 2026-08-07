'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ExternalLink } from '@/components/common/external-link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { env } from '@/config/env';
import {
  isWeb3AuthConfigured,
  RequireWagmi,
  useConfiguredWalletSession,
} from '@/features/auth';
import { readTelemetryReadingFields } from '@/features/telemetry';

import {
  createDemoTelemetryApi,
  type DemoTelemetryResponse,
  type DemoVerifyResponse,
} from './demo-telemetry-api';

type PanelState =
  | { kind: 'idle' }
  | { kind: 'result'; data: DemoTelemetryResponse }
  | { kind: 'error'; message: string };

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'result'; data: DemoVerifyResponse }
  | { kind: 'error'; message: string };

export function RequestTelemetryPanel(props: {
  readonly walletAddress: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
}) {
  if (!isWeb3AuthConfigured()) {
    return (
      <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Connect Web3Auth to request a quote, pay to unlock, then verify.
        </p>
      </div>
    );
  }
  return (
    <RequireWagmi
      fallback={
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <p className="text-xs text-slate-500">Initializing wallet…</p>
        </div>
      }
    >
      <RequestTelemetryPanelConnected {...props} />
    </RequireWagmi>
  );
}

function RequestTelemetryPanelConnected(props: {
  readonly walletAddress: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
}) {
  const router = useRouter();
  const session = useConfiguredWalletSession();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const [verifyState, setVerifyState] = useState<VerifyState>({ kind: 'idle' });

  async function idTokenOrThrow(): Promise<string> {
    return session.getIdToken();
  }

  function runQuote() {
    setState({ kind: 'idle' });
    setVerifyState({ kind: 'idle' });
    startTransition(async () => {
      try {
        const idToken = await idTokenOrThrow();
        const api = createDemoTelemetryApi();
        const data = await api.quote({
          idToken,
          walletAddress: props.walletAddress,
          deviceId: props.deviceId,
        });
        setState({ kind: 'result', data });
      } catch (error) {
        setState({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Request failed — connect Web3Auth and ensure a new record exists.',
        });
      }
    });
  }

  function runSettle() {
    startTransition(async () => {
      try {
        const idToken = await idTokenOrThrow();
        const api = createDemoTelemetryApi();
        const data = await api.settle({
          idToken,
          walletAddress: props.walletAddress,
          deviceId: props.deviceId,
        });
        setState({ kind: 'result', data });
        setVerifyState({ kind: 'idle' });
      } catch (error) {
        setState({
          kind: 'error',
          message:
            error instanceof Error ? error.message : 'Payment settle failed',
        });
      }
    });
  }

  function runVerify(
    delivered: Extract<
      DemoTelemetryResponse,
      { status: 'TELEMETRY_DELIVERED' }
    >,
  ) {
    startTransition(async () => {
      try {
        const idToken = await idTokenOrThrow();
        const api = createDemoTelemetryApi();
        const data = await api.verify({
          idToken,
          walletAddress: props.walletAddress,
          deviceId: props.deviceId,
          telemetryRecordId: delivered.telemetry.recordId,
          paymentTransactionHash: delivered.payment.transactionHash,
        });
        setVerifyState({ kind: 'result', data });
        window.setTimeout(() => {
          router.refresh();
        }, 0);
      } catch (error) {
        setVerifyState({
          kind: 'error',
          message:
            error instanceof Error ? error.message : 'Verification failed',
        });
      }
    });
  }

  const result = state.kind === 'result' ? state.data : null;
  const needsPay = result?.status === 'PAYMENT_REQUIRED';
  const connected = session.status === 'connected';

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-400">
        <li>
          <span className="font-medium text-slate-800 dark:text-slate-200">
            Request latest
          </span>{' '}
          — get a Circle Gateway nanopayment quote for {props.deviceLabel}.
        </li>
        <li>
          <span className="font-medium text-slate-800 dark:text-slate-200">
            Pay & unlock
          </span>{' '}
          — settle the quote to reveal the payload and Arcscan payment link.
        </li>
        <li>
          <span className="font-medium text-slate-800 dark:text-slate-200">
            Verify
          </span>{' '}
          — independently check Arc settlement + content hash (increments
          Verified count).
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="px-3 py-1.5 text-xs"
          disabled={pending || !connected}
          onClick={runQuote}
        >
          {pending && !needsPay && verifyState.kind === 'idle'
            ? 'Requesting…'
            : 'Request latest'}
        </Button>
        {needsPay ? (
          <Button
            type="button"
            className="bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            disabled={pending || !connected}
            onClick={runSettle}
          >
            {pending ? 'Paying…' : 'Pay & unlock'}
          </Button>
        ) : null}
      </div>

      {!connected ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Connect Web3Auth to request, pay, and verify.
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.message}
        </p>
      ) : null}

      {result?.status === 'PAYMENT_REQUIRED' ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="warning">Payment required</StatusBadge>
            <span className="font-semibold">Pay to unlock telemetry</span>
          </div>
          <p>
            Quote:{' '}
            <span className="font-semibold">
              {result.paymentRequirement.amountDisplay}{' '}
              {result.paymentRequirement.asset}
            </span>
            . Click <span className="font-semibold">Pay & unlock</span> to
            settle via Circle Gateway. The record stays hidden until payment
            succeeds.
          </p>
          <p className="font-mono text-[11px] break-all text-amber-900/80 dark:text-amber-200/80">
            requirement {result.paymentRequirement.id} · expires{' '}
            {result.paymentRequirement.expiresAt}
          </p>
          {'demoNote' in result && result.demoNote !== undefined ? (
            <p className="text-amber-800 dark:text-amber-200">
              {result.demoNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {result?.status === 'TELEMETRY_DELIVERED' ? (
        <UnlockedTelemetry
          result={result}
          pending={pending}
          connected={connected}
          verifyState={verifyState}
          onVerify={() => {
            runVerify(result);
          }}
        />
      ) : null}

      {result?.status === 'NO_NEW_RECORD' ? (
        <div
          role="status"
          className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <StatusBadge tone="info">Already unlocked</StatusBadge>
          <p className="mt-2">
            You already paid for the latest record. Wait for a new Enode webhook
            (or inject telemetry) before requesting again.
          </p>
        </div>
      ) : null}

      {result?.status === 'NO_TELEMETRY_AVAILABLE' ? (
        <div
          role="status"
          className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <StatusBadge tone="neutral">No telemetry</StatusBadge>
          <p className="mt-2">
            Nothing to buy yet for this device. Ingest an Enode webhook or run
            the demo inject script first.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function UnlockedTelemetry({
  result,
  pending,
  connected,
  verifyState,
  onVerify,
}: {
  readonly result: Extract<
    DemoTelemetryResponse,
    { status: 'TELEMETRY_DELIVERED' }
  >;
  readonly pending: boolean;
  readonly connected: boolean;
  readonly verifyState: VerifyState;
  readonly onVerify: () => void;
}) {
  const txHash = result.payment.transactionHash;
  const explorerHref = `${env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL.replace(/\/$/, '')}/tx/${txHash}`;
  const readings = readTelemetryReadingFields(result.telemetry.data);
  const verified = verifyState.kind === 'result';

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="success">Unlocked</StatusBadge>
        <span className="font-semibold">Telemetry delivered</span>
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {readings.map((field) => (
          <div key={field.label}>
            <dt className="text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80">
              {field.label}
            </dt>
            <dd className="text-sm font-semibold">{field.value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80">
            Recorded at
          </dt>
          <dd className="font-mono text-[11px] break-all">
            {result.telemetry.recordedAt}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80">
            Provenance
          </dt>
          <dd>{result.provenance.status}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80">
            Record ID
          </dt>
          <dd className="font-mono text-[11px] break-all">
            {result.telemetry.recordId}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80">
            Content hash
          </dt>
          <dd className="font-mono text-[11px] break-all">
            {result.provenance.contentHash}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1 border-t border-emerald-200 pt-2 dark:border-emerald-800">
        <span className="text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80">
          Payment on Arcscan
        </span>
        <ExternalLink
          href={explorerHref}
          className="inline-flex w-fit items-center font-semibold text-emerald-700 underline decoration-2 underline-offset-4 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
        >
          View settlement transaction
        </ExternalLink>
        <p className="font-mono text-[11px] break-all text-emerald-900/80 dark:text-emerald-100/80">
          {txHash}
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-emerald-200 pt-3 dark:border-emerald-800">
        <p className="font-medium text-emerald-950 dark:text-emerald-50">
          Independent verification
        </p>
        <p className="text-emerald-900/90 dark:text-emerald-100/90">
          Checks the settlement on Arc and that the content hash matches. This
          is evidence for the dashboard Verified count — not unlock
          authorization.
        </p>
        <Button
          type="button"
          className="w-fit bg-emerald-800 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          disabled={pending || !connected || verified}
          onClick={onVerify}
        >
          {pending && !verified
            ? 'Verifying…'
            : verified
              ? 'Verified'
              : 'Verify on Arc'}
        </Button>

        {verifyState.kind === 'error' ? (
          <p role="alert" className="text-red-700 dark:text-red-300">
            {verifyState.message}
          </p>
        ) : null}

        {verifyState.kind === 'result' ? (
          <div className="flex flex-col gap-1 rounded-md border border-emerald-400/60 bg-white/50 p-2 dark:bg-emerald-950/50">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={
                  verifyState.data.status === 'VERIFIED' ? 'success' : 'danger'
                }
              >
                {verifyState.data.status}
              </StatusBadge>
              <span>
                receiptFound={String(verifyState.data.receiptFound)} ·
                hashMatched={String(verifyState.data.contentHashMatched)}
              </span>
            </div>
            <p className="font-mono text-[11px] break-all opacity-80">
              expected {verifyState.data.contentHashExpected}
            </p>
          </div>
        ) : null}
      </div>

      {'demoNote' in result && result.demoNote !== undefined ? (
        <p className="text-emerald-900/90 dark:text-emerald-100/90">
          {result.demoNote}
        </p>
      ) : null}
    </div>
  );
}
