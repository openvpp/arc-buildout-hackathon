'use client';

import { useGoogleLogin } from '@react-oauth/google';
import { useState } from 'react';

/**
 * Only ever mounted when Google is configured (see CircleAuthModal) — calling
 * useGoogleLogin outside a GoogleOAuthProvider throws, so this must not be
 * unconditionally rendered.
 *
 * Fetches the user's email client-side via Google's userinfo endpoint, same
 * as openvpp-app's CircleAuthModal did — not verified server-side. That's
 * the same trust level as the plain-email path (see bind-dashboard-owner.ts):
 * Google here is a convenience for typing your email, not a security proof.
 */
export function GoogleContinueButton({
  disabled,
  onEmail,
  onError,
}: {
  disabled: boolean;
  onEmail: (email: string) => void;
  onError: (message: string) => void;
}) {
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);

  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      setIsFetchingProfile(true);
      void (async () => {
        try {
          const response = await fetch(
            `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${tokenResponse.access_token}`,
          );
          const profile = (await response.json()) as { email?: string };
          if (profile.email === undefined || profile.email.length === 0) {
            onError('Google account has no email.');
            return;
          }
          onEmail(profile.email);
        } catch {
          onError('Failed to read Google profile.');
        } finally {
          setIsFetchingProfile(false);
        }
      })();
    },
    onError: () => {
      onError('Google sign-in failed.');
    },
  });

  return (
    <button
      type="button"
      onClick={() => {
        login();
      }}
      disabled={disabled || isFetchingProfile}
      className="flex items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-medium text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      {isFetchingProfile ? 'Connecting…' : 'Continue with Google'}
    </button>
  );
}
