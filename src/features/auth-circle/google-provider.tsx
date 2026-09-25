'use client';

import { GoogleOAuthProvider } from '@react-oauth/google';
import type { ReactNode } from 'react';

import { env } from '@/config/env';

export function isGoogleSignInConfigured(): boolean {
  return env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.trim().length > 0;
}

/** Wraps the app in Google's OAuth provider. No-op when unconfigured. */
export function CircleGoogleProvider({ children }: { children: ReactNode }) {
  if (!isGoogleSignInConfigured()) {
    return <>{children}</>;
  }
  return (
    <GoogleOAuthProvider clientId={env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID}>
      {children}
    </GoogleOAuthProvider>
  );
}
