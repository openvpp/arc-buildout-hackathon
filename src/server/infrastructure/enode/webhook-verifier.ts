import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify Enode's `x-enode-signature: sha1=<hex>` HMAC-SHA1 over the raw body. */
export function verifyEnodeWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
}): boolean {
  if (input.signatureHeader === null || input.signatureHeader.length === 0) {
    return false;
  }
  const separator = input.signatureHeader.indexOf('=');
  if (separator <= 0) {
    return false;
  }
  const scheme = input.signatureHeader.slice(0, separator);
  const providedHex = input.signatureHeader.slice(separator + 1);
  if (scheme !== 'sha1' || !/^[0-9a-f]{40}$/i.test(providedHex)) {
    return false;
  }
  const expectedHex = createHmac('sha1', input.secret)
    .update(input.rawBody, 'utf8')
    .digest('hex');
  const provided = Buffer.from(providedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
