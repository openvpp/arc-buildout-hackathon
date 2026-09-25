'use client';

import { useEffect, useState } from 'react';

import { CircleAuthModal } from './circle-auth-modal';
import { useCircleSession } from './use-circle-session';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Header trigger for the Circle developer-controlled wallet sign-in popup
 * (see CircleAuthModal) — mirrors openvpp-app's header WalletButton opening
 * CircleAuthModal. Connected state shows the wallet address; disconnected
 * shows a "Sign in" trigger.
 */
export function CircleAuthButton() {
  const { state, signInWithEmail, signOut } = useCircleSession();
  const [modalOpen, setModalOpen] = useState(false);

  // Close the popup once sign-in actually succeeds; on error it stays open
  // so the error banner (rendered inside the modal) is visible.
  useEffect(() => {
    if (state.status === 'signed_in') {
      setModalOpen(false);
    }
  }, [state.status]);

  if (state.status === 'signed_in') {
    return (
      <button
        type="button"
        title={state.walletAddress}
        onClick={() => {
          void signOut();
        }}
        className="flex h-[50px] items-center gap-2 rounded-md bg-itemground px-3 font-mono text-xs text-white/80 hover:bg-white/10"
      >
        <span className="h-2 w-2 rounded-full bg-primary-500" />
        {shortenAddress(state.walletAddress)}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setModalOpen(true);
        }}
        className="flex h-[50px] items-center rounded-md border border-primary-500 px-4 text-sm font-medium text-primary-500 hover:bg-primary-500/10"
      >
        Sign in
      </button>
      <CircleAuthModal
        open={modalOpen}
        isSubmitting={state.status === 'signing_in'}
        sessionError={state.status === 'idle' ? state.error : null}
        onClose={() => {
          setModalOpen(false);
        }}
        onSubmitEmail={(email) => {
          void signInWithEmail(email);
        }}
      />
    </>
  );
}
