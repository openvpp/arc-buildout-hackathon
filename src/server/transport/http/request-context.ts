import { randomUUID } from 'node:crypto';

export type RequestContext = {
  requestId: string;
};

const INCOMING_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uses a caller-supplied UUID when it is well-formed; otherwise mints one. */
export function createRequestContext(request?: Request): RequestContext {
  const incoming = request?.headers.get('x-request-id')?.trim() ?? '';
  return {
    requestId: INCOMING_REQUEST_ID.test(incoming) ? incoming : randomUUID(),
  };
}
