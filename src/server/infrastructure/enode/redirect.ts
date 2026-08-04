import { getServerEnv } from '@/server/config/env';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

export function getEnodeFrontendBaseUrl(): string {
  const env = getServerEnv();
  const configured = env.ENODE_FRONTEND_URL;
  if (configured !== undefined && configured.length > 0) {
    return trimTrailingSlash(configured);
  }
  return 'http://localhost:3000';
}

export function getEnodeRedirectUri(): string {
  const env = getServerEnv();
  if (
    env.ENODE_REDIRECT_URI !== undefined &&
    env.ENODE_REDIRECT_URI.length > 0
  ) {
    return env.ENODE_REDIRECT_URI;
  }
  return `${getEnodeFrontendBaseUrl()}/enode/complete`;
}

export function appendQueryParam(
  url: string,
  key: string,
  value: string,
): string {
  if (url.length === 0) {
    return url;
  }
  const enc = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  if (url.includes('#')) {
    const [pathQuery, hash] = url.split('#', 2);
    const base = pathQuery ?? '';
    return `${base}${base.includes('?') ? '&' : '?'}${enc}#${hash ?? ''}`;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${enc}`;
}

export function buildEnodeLinkTokenUrl(linkToken: string): string {
  return `${getEnodeFrontendBaseUrl()}/enode/link?token=${encodeURIComponent(linkToken)}`;
}

export function normalizeBrand(brand: string): string {
  return brand.trim().toUpperCase().replace(/\s+/g, '_');
}
