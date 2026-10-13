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

export type PasswordSignInIntent = 'register' | 'login';

/** Establish / clear the httpOnly dashboard session cookie for the Circle DCW flow. */
export function createCircleSessionApi(client: ApiClient = new ApiClient()) {
  return {
    async establishWithPassword(input: {
      email: string;
      password: string;
      intent: PasswordSignInIntent;
    }) {
      const result = await client.request('/api/v1/dashboard/session', {
        method: 'POST',
        body: input,
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
