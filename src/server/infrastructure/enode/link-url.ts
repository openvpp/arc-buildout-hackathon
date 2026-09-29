/**
 * Enode Link UI hosts. The browser navigates to whatever URL we return
 * from the link endpoint, so a surprising host must never leave the server.
 */
const EXACT_HOSTS = new Set(['link.enode.com']);

export function isAllowedEnodeLinkUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return false;
  }
  if (parsed.port.length > 0 && parsed.port !== '443') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (EXACT_HOSTS.has(host)) {
    return true;
  }
  if (!host.endsWith('.enode.io')) {
    return false;
  }
  return host.split('.')[0] === 'link';
}
