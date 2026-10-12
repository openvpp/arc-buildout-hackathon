import { ApplicationError } from '@/server/application/application-error';
import {
  bindDashboardOwner,
  type BoundIdentity,
} from '@/server/application/onboarding/bind-dashboard-owner';
import type { Database } from '@/server/infrastructure/db/client';
import {
  emailFromGoogleIdToken,
  GoogleIdTokenError,
} from '@/server/infrastructure/google/verify-google-id-token';

/**
 * Open the Circle wallet for the Google account that just signed in.
 * The email comes from the verified ID token, then the wallet is
 * found-or-created server-side.
 */
export async function signInWithGoogle(
  db: Database,
  input: { idToken: string },
): Promise<BoundIdentity> {
  let email: string;
  try {
    email = await emailFromGoogleIdToken(input.idToken);
  } catch (error) {
    if (error instanceof GoogleIdTokenError) {
      throw new ApplicationError(
        error.reason === 'unavailable'
          ? 'GOOGLE_SIGN_IN_UNAVAILABLE'
          : 'GOOGLE_SIGN_IN_FAILED',
        error.message,
      );
    }
    throw error;
  }
  return bindDashboardOwner(db, { email });
}
