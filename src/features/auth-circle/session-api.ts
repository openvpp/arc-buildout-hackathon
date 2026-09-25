import { z } from 'zod';

import { ApiClient } from '@/lib/api/client';

const establishSchema = z.object({
  principalId: z.string().uuid(),
  walletId: z.string().uuid(),
  walletAddress: z.string(),
});

const clearSchema = z.object({
  ok: z.literal(true),
});

/** Establish / clear the httpOnly dashboard session cookie via Circle/Google login. */
export function createCircleSessionApi(client: ApiClient = new ApiClient()) {
  return {
    async establish(input: { googleIdToken: string }) {
      const result = await client.request('/api/v1/dashboard/session', {
        method: 'POST',
        body: { googleIdToken: input.googleIdToken },
        schema: establishSchema,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    async clear() {
      const result = await client.request('/api/v1/dashboard/session', {
        method: 'DELETE',
        schema: clearSchema,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
  };
}
