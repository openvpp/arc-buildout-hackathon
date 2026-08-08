'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  isWeb3AuthConfigured,
  RequireWeb3Auth,
  useConfiguredWalletSession,
} from '@/features/auth';

import {
  createDemoTelemetryApi,
  type DemoVerifyResponse,
} from './demo-telemetry-api';

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'result'; data: DemoVerifyResponse }
  | { kind: 'error'; message: string };

/**
 * Arc settlement + content-hash re-check for a past telemetry row.
 * Evidence only — does not authorize unlock.
 */
export function VerifyTelemetryButton(props: {
  readonly walletAddress: string;
  readonly deviceId: string;
  readonly telemetryRecordId: string;
  readonly paymentTransactionHash: string;
  readonly initialStatus: string | null;
}) {
  if (!isWeb3AuthConfigured()) {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-300">
        Connect Web3Auth to verify this settlement.
      </p>
    );
  }
  return (
    <RequireWeb3Auth
      fallback={<p className="text-xs text-slate-500">Initializing wallet…</p>}
    >
      <VerifyTelemetryButtonConnected {...props} />
    </RequireWeb3Auth>
  );
}

function VerifyTelemetryButtonConnected(props: {
  readonly walletAddress: string;
  readonly deviceId: string;
  readonly telemetryRecordId: string;
  readonly paymentTransactionHash: string;
  readonly initialStatus: string | null;
}) {
  const router = useRouter();
  const session = useConfiguredWalletSession();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<VerifyState>({ kind: 'idle' });

  const alreadyVerified =
    props.initialStatus === 'VERIFIED' ||
    (state.kind === 'result' && state.data.status === 'VERIFIED');
  const connected = session.status === 'connected';

  function runVerify() {
    startTransition(async () => {
      try {
        const idToken = await session.getIdToken();
        const api = createDemoTelemetryApi();
        const data = await api.verify({
          idToken,
          walletAddress: props.walletAddress,
          deviceId: props.deviceId,
          telemetryRecordId: props.telemetryRecordId,
          paymentTransactionHash: props.paymentTransactionHash,
        });
        setState({ kind: 'result', data });
        window.setTimeout(() => {
          router.refresh();
        }, 0);
      } catch (error) {
        setState({
          kind: 'error',
          message:
            error instanceof Error ? error.message : 'Verification failed',
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className="w-fit bg-emerald-800 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
        disabled={pending || !connected || alreadyVerified}
        onClick={runVerify}
      >
        {pending && !alreadyVerified
          ? 'Verifying…'
          : alreadyVerified
            ? 'Verified on Arc'
            : 'Verify on Arc'}
      </Button>

      {!connected ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Connect Web3Auth to verify.
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.message}
        </p>
      ) : null}

      {state.kind === 'result' ? (
        <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={
                state.data.status === 'VERIFIED'
                  ? 'success'
                  : state.data.status === 'PENDING_ONCHAIN'
                    ? 'warning'
                    : 'danger'
              }
            >
              {state.data.status === 'PENDING_ONCHAIN'
                ? 'Pending on Arc'
                : state.data.status}
            </StatusBadge>
            <span>
              receiptFound={String(state.data.receiptFound)} · hashMatched=
              {String(state.data.contentHashMatched)}
            </span>
          </div>
          {state.data.resolvedTransactionHash !== undefined &&
          state.data.resolvedTransactionHash !== null ? (
            <p className="font-mono text-[11px] break-all opacity-80">
              resolved {state.data.resolvedTransactionHash}
            </p>
          ) : null}
          {state.data.status === 'PENDING_ONCHAIN' ? (
            <p className="text-amber-800 dark:text-amber-200">
              Circle has not published an on-chain hash yet — retry shortly.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
