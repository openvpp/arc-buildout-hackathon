import { z } from 'zod';

import { ApiClient } from '@/lib/api/client';

const linkResponseSchema = z.object({
  supported: z.literal(true),
  linkUrl: z.string().min(1),
  pendingConnectionId: z.string().uuid(),
});

const oauthCompleteSchema = z.object({
  ok: z.literal(true),
  pendingId: z.string().uuid(),
  status: z.string(),
  requiresForm: z.boolean(),
});

const finalizeSchema = z.object({
  success: z.literal(true),
  wasExistingDevice: z.boolean(),
  device: z.object({ id: z.string(), displayName: z.string().nullable() }),
  mintStatus: z.string(),
});

/** Onboarding calls. Auth is the httpOnly dashboard session cookie — no bearer needed. */
export function createOnboardingApi(client: ApiClient = new ApiClient()) {
  return {
    async startLink(input: { brand?: string }) {
      const result = await client.request('/api/v1/vehicle-onboarding/link', {
        method: 'POST',
        body: input.brand !== undefined ? { brand: input.brand } : {},
        schema: linkResponseSchema,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    async completeOAuth(input: { pendingId: string }) {
      const result = await client.request(
        '/api/v1/vehicle-onboarding/oauth/enode-complete',
        {
          method: 'GET',
          searchParams: { pendingId: input.pendingId },
          schema: oauthCompleteSchema,
        },
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    async finalize(input: { pendingId: string; nickname?: string }) {
      const result = await client.request(
        `/api/v1/vehicle-onboarding/pending/${input.pendingId}/complete`,
        {
          method: 'POST',
          body: {
            ...(input.nickname !== undefined
              ? { nickname: input.nickname }
              : {}),
            consentAccepted: true,
          },
          schema: finalizeSchema,
        },
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
  };
}
