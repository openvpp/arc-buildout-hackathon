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

/**
 * Establish / clear the httpOnly owner dashboard session cookie.
 */
export function createDashboardSessionApi(client: ApiClient = new ApiClient()) {
  return {
    async establish(input: {
      readonly idToken: string;
      readonly walletAddress: string;
    }) {
      const result = await client.request('/api/v1/dashboard/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.idToken}` },
        body: { walletAddress: input.walletAddress },
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
