'use client';

import { useState } from 'react';

import { Modal } from '@/components/ui/modal';

import { GoogleContinueButton } from './google-continue-button';
import { isGoogleSignInConfigured } from './google-provider';

/**
 * Sign-in popup for the Circle developer-controlled wallet flow: a
 * "Continue with Google" option, an "OR" divider, then a direct email
 * path. External wallet-connect buttons (MetaMask, Coinbase, WalletConnect,
 * etc.) are intentionally left out — those aren't part of this milestone's
 * Circle DCW flow.
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

  return (
    <Modal
      open={open}
      title="Connect Wallet"
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <p className="mb-6 text-white/70">
        Sign in to create your Circle wallet and get started
      </p>

      {displayedError !== null ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500 bg-red-500/20 p-3 text-sm text-red-300"
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
            <span className="text-sm text-white/60">OR</span>
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
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-white/80">Email address</span>
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              disabled={isSubmitting}
              className="rounded-lg border border-white/15 bg-black px-4 py-3 text-white placeholder:text-white/60 focus:border-primary-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting || email.trim().length === 0}
            className="flex items-center justify-center gap-3 rounded-lg bg-primary-500 px-4 py-3 font-medium text-black transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Creating wallet…' : 'Create Wallet'}
          </button>
        </form>
      </div>
    </Modal>
  );
}
