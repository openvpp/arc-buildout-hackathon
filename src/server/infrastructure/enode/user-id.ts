import { getServerEnv } from '@/server/config/env';

/**
 * The Enode user id we ask Enode to create/reuse for this wallet. Stable per
 * wallet, environment-scoped so demo/staging/prod never collide on the same
 * Enode account.
 */
export function encodeEnodeUserId(walletId: string): string {
  const env = getServerEnv();
  return `${env.APP_ENV}:${walletId}`;
}
