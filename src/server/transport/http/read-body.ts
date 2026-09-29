import { ApiError } from '@/server/transport/http/api-error';

/** JSON API bodies. Webhook deliveries use a separate, larger cap. */
export const JSON_BODY_MAX_BYTES = 16 * 1024;
export const WEBHOOK_BODY_MAX_BYTES = 256 * 1024;

function contentLengthExceeds(request: Request, maxBytes: number): boolean {
  const declared = request.headers.get('content-length');
  if (declared === null || declared.length === 0) {
    return false;
  }
  const size = Number(declared);
  return Number.isFinite(size) && size > maxBytes;
}

async function readLimitedText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (contentLengthExceeds(request, maxBytes)) {
    throw new ApiError({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large.',
      status: 413,
    });
  }
  if (request.body === null) {
    return '';
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value === undefined) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large.',
        status: 413,
      });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/** Reads a JSON body, rejecting anything over `maxBytes` before it is parsed. */
export async function readJsonBody(
  request: Request,
  maxBytes: number = JSON_BODY_MAX_BYTES,
): Promise<unknown> {
  const text = await readLimitedText(request, maxBytes);
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid JSON body.',
      status: 400,
    });
  }
}

export async function readWebhookBody(request: Request): Promise<string> {
  return readLimitedText(request, WEBHOOK_BODY_MAX_BYTES);
}
