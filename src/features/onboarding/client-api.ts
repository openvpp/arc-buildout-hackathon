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
  device: z.object({
    id: z.string(),
    displayName: z.string().nullable(),
  }),
});

/**
 * Dashboard onboarding calls (read/write via typed API client).
 * Temporary until Web3Auth replaces walletAddress body auth.
 */
export function createOnboardingApi(client: ApiClient = new ApiClient()) {
  return {
    async startLink(input: {
      walletAddress: string;
      brand?: string;
      frontendUrl: string;
    }) {
      const result = await client.request('/api/v1/vehicle-onboarding/link', {
        method: 'POST',
        body: {
          walletAddress: input.walletAddress,
          ...(input.brand !== undefined && input.brand.length > 0
            ? { brand: input.brand }
            : {}),
          frontendUrl: input.frontendUrl,
        },
        schema: linkResponseSchema,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },

    async completeOAuth(input: { ovppPending: string; walletAddress: string }) {
      const result = await client.request(
        '/api/v1/vehicle-onboarding/oauth/enode-complete',
        {
          method: 'GET',
          searchParams: {
            ovppPending: input.ovppPending,
            walletAddress: input.walletAddress,
          },
          schema: oauthCompleteSchema,
        },
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },

    async finalize(input: {
      pendingId: string;
      walletAddress: string;
      nickname?: string;
    }) {
      const result = await client.request(
        `/api/v1/vehicle-onboarding/pending/${input.pendingId}/complete`,
        {
          method: 'POST',
          body: {
            walletAddress: input.walletAddress,
            formData: {
              ...(input.nickname !== undefined && input.nickname.length > 0
                ? { nickname: input.nickname }
                : {}),
              consentAccepted: true,
            },
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
