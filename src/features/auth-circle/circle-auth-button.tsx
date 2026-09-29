'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useDeviceOnboardModal } from '@/features/onboarding';

import { CircleAuthModal } from './circle-auth-modal';
import { useCircleSession } from './use-circle-session';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Signed-in wallet chip: shows the shortened address, a copy-to-clipboard
 * icon, and a dropdown (Devices / Add vehicle / Log out) — everything that
 * requires a wallet lives behind this trigger rather than as standalone
 * header links, since none of it is usable signed out.
 */
function WalletMenu({
  walletAddress,
  onSignOut,
}: {
  walletAddress: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const openDeviceOnboardModal = useDeviceOnboardModal();

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  return (
    <div className="relative">
      {open ? (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setOpen(false);
          }}
        />
      ) : null}
      <div className="flex h-[50px] items-center gap-1 rounded-md bg-itemground pr-1 text-white/80">
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="flex h-full items-center gap-2 rounded-md pl-3 pr-1 font-mono text-xs hover:text-white"
        >
          <span className="h-2 w-2 rounded-full bg-primary-500" />
          {shortenAddress(walletAddress)}
        </button>
        <button
          type="button"
          aria-label="Copy wallet address"
          title={copied ? 'Copied' : 'Copy wallet address'}
          onClick={() => {
            void navigator.clipboard.writeText(walletAddress).then(() => {
              setCopied(true);
            });
          }}
          className="rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <CopyIcon />
        </button>
      </div>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-48 rounded-lg border border-modalborder bg-modalbg p-1 shadow-xl">
          <Link
            href="/devices"
            onClick={() => {
              setOpen(false);
            }}
            className="block rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            Devices
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openDeviceOnboardModal();
            }}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            Add vehicle
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Header trigger for the Circle developer-controlled wallet sign-in popup
 * (see CircleAuthModal) — mirrors openvpp-app's header WalletButton opening
 * CircleAuthModal. Connected state shows the wallet chip (see WalletMenu);
 * disconnected shows a "Sign in" trigger.
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
      <WalletMenu
        walletAddress={state.walletAddress}
        onSignOut={() => {
          void signOut();
        }}
      />
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
