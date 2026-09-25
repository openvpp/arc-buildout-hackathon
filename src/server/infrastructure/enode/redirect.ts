import { getServerEnv } from '@/server/config/env';

export function getEnodeRedirectUri(): string {
  const env = getServerEnv();
  if (
    env.ENODE_REDIRECT_URI !== undefined &&
    env.ENODE_REDIRECT_URI.length > 0
  ) {
    return env.ENODE_REDIRECT_URI;
  }
  const frontendUrl = env.ENODE_FRONTEND_URL ?? 'http://localhost:3000';
  return `${frontendUrl.replace(/\/$/, '')}/enode/complete`;
}

export function appendQueryParam(
  url: string,
  key: string,
  value: string,
): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

export function buildEnodeLinkTokenUrl(linkToken: string): string {
  return `https://link.enode.com/?linkToken=${encodeURIComponent(linkToken)}`;
}

export function normalizeBrand(brand: string): string {
  return brand.trim().toUpperCase().replace(/\s+/g, '_');
}
