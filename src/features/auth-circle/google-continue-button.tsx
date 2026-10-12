'use client';

import { GoogleLogin } from '@react-oauth/google';

/**
 * Only ever mounted when Google is configured (see CircleAuthModal) —
 * GoogleLogin outside a GoogleOAuthProvider throws, so this must not be
 * unconditionally rendered.
 *
 * The button returns a Google ID token. The server verifies it. This
 * component never reads or submits an email.
 */
export function GoogleContinueButton({
  disabled,
  onCredential,
  onError,
}: {
  disabled: boolean;
  onCredential: (idToken: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div
      className={`flex justify-center ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <GoogleLogin
        theme="outline"
        size="large"
        text="continue_with"
        shape="rectangular"
        width={280}
        onSuccess={(response) => {
          if (
            response.credential === undefined ||
            response.credential.length === 0
          ) {
            onError('Google sign-in failed.');
            return;
          }
          onCredential(response.credential);
        }}
        onError={() => {
          onError('Google sign-in failed.');
        }}
      />
    </div>
  );
}
