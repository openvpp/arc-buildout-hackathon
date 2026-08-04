/**
 * Enode user id encoding for multi-environment isolation.
 * production/demo → bare wallet; other APP_ENV → `${env}::${wallet}`.
 */

export const ENV_USERID_DELIMITER = '::' as const;

export type DecodedEnodeUserId = {
  environment: string;
  appUserId: string;
};

export function normalizeEnvironment(value?: string | null): string {
  const v = (value ?? '').trim().toLowerCase();
  return v.length > 0 ? v : 'production';
}

export function encodeEnodeUserId(
  environment: string | null | undefined,
  walletAddress: string,
): string {
  const env = normalizeEnvironment(environment);
  const id = walletAddress.trim();
  if (env === 'production' || env === 'demo') {
    return id;
  }
  return `${env}${ENV_USERID_DELIMITER}${id}`;
}

export function decodeEnodeUserId(rawUserId: string): DecodedEnodeUserId {
  const raw = rawUserId.trim();
  const idx = raw.indexOf(ENV_USERID_DELIMITER);
  if (idx <= 0) {
    return { environment: 'production', appUserId: raw };
  }
  const environment = normalizeEnvironment(raw.slice(0, idx));
  const appUserId = raw.slice(idx + ENV_USERID_DELIMITER.length).trim();
  if (appUserId.length === 0) {
    return { environment: 'production', appUserId: raw };
  }
  return { environment, appUserId };
}

export function linkEnvironmentFromAppEnv(appEnv: string): string {
  return normalizeEnvironment(appEnv);
}
