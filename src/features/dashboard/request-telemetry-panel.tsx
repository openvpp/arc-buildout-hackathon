'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  function runQuote() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      try {
        const api = createDemoTelemetryApi();
        const data = await api.quote({
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
              : 'Request failed (is ALLOW_MOCK_ADAPTERS + AGENT_API_KEY set?)',
        });
      }
    });
  }

  function runSettle() {
    startTransition(async () => {
      try {
        const api = createDemoTelemetryApi();
        const data = await api.settle({
          walletAddress: props.walletAddress,
          deviceId: props.deviceId,
        });
        setState({ kind: 'result', data });
        router.refresh();
      } catch (error) {
        setState({
          kind: 'error',
          message:
            error instanceof Error ? error.message : 'Mock settle failed',
        });
      }
    });
  }

  const result = state.kind === 'result' ? state.data : null;
  const needsPay = result?.status === 'PAYMENT_REQUIRED';

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Demo buy flow for {props.deviceLabel} (mock Circle only — not live
        payment).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="px-2 py-1 text-xs"
          disabled={pending}
          onClick={runQuote}
        >
          {pending ? 'Working…' : 'Request latest'}
        </Button>
        {needsPay ? (
          <Button
            type="button"
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={pending}
            onClick={runSettle}
          >
            Pay (mock)
          </Button>
        ) : null}
      </div>

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
              {result.paymentRequirement.asset} → then Pay (mock).
            </p>
          ) : null}
          {result.status === 'NO_NEW_RECORD' ? (
            <p>
              Already delivered this record. Inject new telemetry to buy again.
            </p>
          ) : null}
          {result.status === 'NO_TELEMETRY_AVAILABLE' ? (
            <p>No sellable telemetry yet. Run pnpm demo:inject-telemetry.</p>
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
