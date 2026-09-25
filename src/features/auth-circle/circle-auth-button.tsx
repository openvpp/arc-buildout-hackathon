'use client';

import { GoogleLogin } from '@react-oauth/google';

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
    return <span className="text-xs text-white/40">Sign-in unavailable</span>;
  }

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
    <div className="flex flex-col items-end gap-1">
      <GoogleLogin
        theme="filled_black"
        shape="pill"
        size="medium"
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
          className="max-w-48 text-right text-[10px] text-red-400"
        >
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
