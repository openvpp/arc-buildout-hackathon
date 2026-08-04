/**
 * IPv4 allowlist / CIDR matcher for Enode webhook ingress.
 * Empty allowlist means "not configured" (caller decides allow-all vs deny).
 */

export function parseIpAllowlist(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function matchCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split('/');
  if (network === undefined || prefixRaw === undefined) {
    return false;
  }
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  if (ipInt === null || networkInt === null) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const mask = (0xffff_ffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}

/**
 * Returns true if `ip` is allowed by any exact IPv4 or IPv4 CIDR entry.
 * IPv6 allowlisting is not implemented — IPv6 clients are rejected when the
 * allowlist is non-empty unless an exact string match exists.
 */
export function isIpAllowed(
  ip: string | undefined,
  allowlist: readonly string[],
): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  if (ip === undefined || ip.length === 0) {
    return false;
  }
  const normalized = ip.trim().toLowerCase();
  for (const entry of allowlist) {
    const candidate = entry.trim().toLowerCase();
    if (candidate.includes('/')) {
      if (matchCidr(normalized, candidate)) {
        return true;
      }
      continue;
    }
    if (candidate === normalized) {
      return true;
    }
  }
  return false;
}

export function extractClientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const first = forwardedFor?.split(',')[0]?.trim();
  if (first !== undefined && first.length > 0) {
    return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp.length > 0) {
    return realIp;
  }
  return undefined;
}
