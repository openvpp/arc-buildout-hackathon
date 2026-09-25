import { randomUUID } from 'node:crypto';

export type RequestContext = {
  requestId: string;
};

export function createRequestContext(): RequestContext {
  return { requestId: randomUUID() };
}
