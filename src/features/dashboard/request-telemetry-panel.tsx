'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  isWeb3AuthConfigured,
  RequireWagmi,
  useConfiguredWalletSession,
} from '@/features/auth';

import {
  createDemoTelemetryApi,
  type DemoTelemetryResponse,
} from './demo-telemetry-api';

type PanelState =
  | { kind: 'idle' }
  | { kind: 'result'; data: DemoTelemetryResponse }
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
          Connect Web3Auth to request / pay for latest telemetry.
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

  async function idTokenOrThrow(): Promise<string> {
    return session.getIdToken();
  }

  function runQuote() {
    setState({ kind: 'idle' });
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
              : 'Request failed — connect Web3Auth and ensure telemetry exists.',
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
        // Defer RSC refresh so Web3Auth/Wagmi aren't torn down mid-settle paint.
        window.setTimeout(() => {
          router.refresh();
        }, 0);
      } catch (error) {
        setState({
          kind: 'error',
          message:
            error instanceof Error ? error.message : 'Payment settle failed',
        });
      }
    });
  }

  const result = state.kind === 'result' ? state.data : null;
  const needsPay = result?.status === 'PAYMENT_REQUIRED';

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Request latest telemetry for {props.deviceLabel}. If there is a new
        Enode event you have not bought, you get a Circle Gateway nanopayment
        quote, then settle.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="px-2 py-1 text-xs"
          disabled={pending || session.status !== 'connected'}
          onClick={runQuote}
        >
          {pending ? 'Working…' : 'Request latest'}
        </Button>
        {needsPay ? (
          <Button
            type="button"
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={pending || session.status !== 'connected'}
            onClick={runSettle}
          >
            Pay & unlock
          </Button>
        ) : null}
      </div>

      {session.status !== 'connected' ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Connect Web3Auth to request / pay for latest telemetry.
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.message}
        </p>
      ) : null}

      {result !== null ? (
        <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <p className="font-medium">Status: {result.status}</p>
          {result.status === 'PAYMENT_REQUIRED' ? (
            <p>
              Amount {result.paymentRequirement.amountDisplay}{' '}
              {result.paymentRequirement.asset} → then Pay & unlock.
            </p>
          ) : null}
          {result.status === 'NO_NEW_RECORD' ? (
            <p>
              Already delivered the latest record. Wait for a new Enode webhook
              (or inject telemetry) to buy again.
            </p>
          ) : null}
          {result.status === 'NO_TELEMETRY_AVAILABLE' ? (
            <p>
              No telemetry yet for this device. Enode webhooks must reach{' '}
              <code>/api/webhooks/enode</code> (public tunnel), or run{' '}
              <code>pnpm demo:inject-telemetry</code>.
            </p>
          ) : null}
          {result.status === 'TELEMETRY_DELIVERED' ? (
            <p className="break-all">
              Delivered record {result.telemetry.recordId}. paymentTx{' '}
              {result.payment.transactionHash}. contentHash{' '}
              {result.provenance.contentHash}
            </p>
          ) : null}
          {'demoNote' in result && result.demoNote !== undefined ? (
            <p className="mt-1 text-amber-700 dark:text-amber-300">
              {result.demoNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
