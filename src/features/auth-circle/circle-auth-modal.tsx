'use client';

import { useState } from 'react';

import { Modal } from '@/components/ui/modal';

import { GoogleContinueButton } from './google-continue-button';
import { isGoogleSignInConfigured } from './google-provider';

/**
 * Sign-in popup for the Circle developer-controlled wallet flow.
 * Continue with Google is the only path: the ID token is verified
 * server-side, so a typed email cannot open someone else's wallet.
 * External wallet-connect buttons (MetaMask, Coinbase, WalletConnect,
 * etc.) are intentionally left out.
 */
export function CircleAuthModal({
  open,
  onClose,
  isSubmitting,
  sessionError,
  onGoogleCredential,
}: {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  sessionError: string | null;
  onGoogleCredential: (idToken: string) => void;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const displayedError = localError ?? sessionError;
  const googleConfigured = isGoogleSignInConfigured();

  return (
    <Modal
      open={open}
      title="Connect Wallet"
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <p className="mb-6 text-white/70">
        Sign in with Google to create your Circle wallet and connect a device.
        Only that Google account can open this wallet.
      </p>

      {displayedError !== null ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500 bg-red-500/20 p-3 text-sm text-red-300"
        >
          {displayedError}
        </div>
      ) : null}

      {googleConfigured ? (
        <GoogleContinueButton
          disabled={isSubmitting}
          onCredential={(idToken) => {
            setLocalError(null);
            onGoogleCredential(idToken);
          }}
          onError={setLocalError}
        />
      ) : (
        <p role="status" className="text-sm text-white/70">
          Google sign-in is not configured.
        </p>
      )}

      {isSubmitting ? (
        <p className="mt-4 text-sm text-white/70">Signing in…</p>
      ) : null}
    </Modal>
  );
}
