'use client';

import { GoogleLogin } from '@react-oauth/google';

import { Button } from '@/components/ui/button';

import { isGoogleSignInConfigured } from './google-provider';
import { useCircleSession } from './use-circle-session';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Sign in / out control for the Circle developer-controlled wallet flow.
 * Identity proof is Google Sign-In; the Circle wallet is created/found
 * server-side and never touches the browser.
 */
export function CircleAuthButton() {
  const { state, signInWithGoogleIdToken, signOut } = useCircleSession();

  if (!isGoogleSignInConfigured()) {
    return <span className="text-xs text-slate-500">Sign-in unavailable</span>;
  }

  if (state.status === 'signed_in') {
    return (
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-xs text-slate-600"
          title={state.walletAddress}
        >
          {shortenAddress(state.walletAddress)}
        </span>
        <Button
          type="button"
          variant="secondary"
          className="px-2 py-1 text-xs"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <GoogleLogin
        onSuccess={(credentialResponse) => {
          if (credentialResponse.credential !== undefined) {
            void signInWithGoogleIdToken(credentialResponse.credential);
          }
        }}
        onError={() => {
          // GoogleLogin surfaces its own inline error UI; nothing to add here.
        }}
      />
      {state.status === 'idle' && state.error !== null ? (
        <span
          role="alert"
          className="max-w-48 text-right text-[10px] text-red-600"
        >
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
