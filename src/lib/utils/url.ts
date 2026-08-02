/**
 * Safe external-URL utilities.
 *
 * Never trust a URL string that originated from an API or user input. Validate
 * the scheme before rendering it as a link or navigating to it, and always
 * apply safe `rel` attributes on external anchors.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parse and validate an external URL. Returns a `URL` only for `http(s)` URLs,
 * otherwise `null`. Rejects `javascript:`, `data:`, and other unsafe schemes.
 */
export function parseSafeExternalUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return ALLOWED_PROTOCOLS.has(url.protocol) ? url : null;
}

export function isSafeExternalUrl(value: string): boolean {
  return parseSafeExternalUrl(value) !== null;
}

/** Safe `rel` value for anchors that open external, untrusted destinations. */
export const EXTERNAL_LINK_REL = 'noopener noreferrer';
