'use client';

import { useState } from 'react';

import { GoogleContinueButton } from './google-continue-button';
import { isGoogleSignInConfigured } from './google-provider';

/**
 * Sign-in popup for the Circle developer-controlled wallet flow — mirrors
 * openvpp-app's CircleAuthModal: a "Continue with Google" option, an "OR"
 * divider, then a direct email path. The wallet-connect tab (MetaMask,
 * Coinbase, WalletConnect, etc.) from the source modal is intentionally
 * left out — those aren't part of this milestone's Circle DCW flow.
 */
export function CircleAuthModal({
  open,
  onClose,
  isSubmitting,
  sessionError,
  onSubmitEmail,
}: {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  sessionError: string | null;
  onSubmitEmail: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const displayedError = localError ?? sessionError;

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[20px] border border-modalborder bg-modalbg p-6"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Connect Wallet</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-white/70 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="mb-6 text-white/50">
          Sign in to create your Circle wallet and get started
        </p>

        {displayedError !== null ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-500 bg-red-500/20 p-3 text-sm text-red-400"
          >
            {displayedError}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          {isGoogleSignInConfigured() ? (
            <GoogleContinueButton
              disabled={isSubmitting}
              onEmail={onSubmitEmail}
              onError={setLocalError}
            />
          ) : null}

          {isGoogleSignInConfigured() ? (
            <div className="my-2 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/15" />
              <span className="text-sm text-white/40">OR</span>
              <div className="h-px flex-1 bg-white/15" />
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              setLocalError(null);
              if (email.trim().length > 0) {
                onSubmitEmail(email.trim());
              }
            }}
            className="flex flex-col gap-3"
          >
            <input
              type="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              disabled={isSubmitting}
              className="rounded-lg border border-white/15 bg-black px-4 py-3 text-white placeholder:text-white/40 focus:border-primary-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSubmitting || email.trim().length === 0}
              className="flex items-center justify-center gap-3 rounded-lg bg-primary-500 px-4 py-3 font-medium text-black transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Creating wallet…' : 'Create Wallet'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
