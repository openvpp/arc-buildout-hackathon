'use client';

import { Button } from '@/components/ui/button';
import {
  isWeb3AuthConfigured,
  useConfiguredWalletSession,
} from '@/features/auth';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ConfiguredWalletConnectButton() {
  const session = useConfiguredWalletSession();

  if (session.status === 'initializing') {
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        Wallet…
      </span>
    );
  }

  if (session.status === 'connected' && session.address !== null) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-xs text-slate-600 dark:text-slate-300"
          title={session.address}
        >
          {shortenAddress(session.address)}
        </span>
        <Button
          type="button"
          variant="secondary"
          className="px-2 py-1 text-xs"
          onClick={() => {
            void session.disconnect();
          }}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        className="px-2 py-1 text-xs"
        disabled={session.isConnecting}
        onClick={() => {
          void session.connect();
        }}
      >
        {session.isConnecting ? 'Connecting…' : 'Connect wallet'}
      </Button>
      {session.connectError !== null ? (
        <span
          role="alert"
          className="max-w-48 text-right text-[10px] text-red-600"
        >
          {session.connectError}
        </span>
      ) : null}
    </div>
  );
}

/** Header control: Connect / address / Disconnect via Web3Auth. */
export function WalletConnectButton() {
  if (!isWeb3AuthConfigured()) {
    return null;
  }
  return <ConfiguredWalletConnectButton />;
}
