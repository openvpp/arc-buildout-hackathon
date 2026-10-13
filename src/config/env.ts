import { z } from 'zod';

import {
  ARC_TESTNET_CHAIN_ID,
  defaultArcExplorerUrl,
} from '@/config/arc-network';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().default(''),
  // Must equal the server's ARC_CHAIN_ID (the server refuses to start
  // otherwise). Drives network naming in the UI, e.g. consent copy.
  NEXT_PUBLIC_ARC_CHAIN_ID: z
    .string()
    .regex(/^\d+$/)
    .default(ARC_TESTNET_CHAIN_ID),
  // Defaults to the explorer for NEXT_PUBLIC_ARC_CHAIN_ID.
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: z.string().optional(),
  // Google OAuth client id for the sign-in button. The server verifies
  // the ID token audience against this same value. If unset, the button
  // is hidden and sign-in is unavailable.
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
});

const parsed = publicEnvSchema.parse({
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_ARC_CHAIN_ID: process.env.NEXT_PUBLIC_ARC_CHAIN_ID || undefined,
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL:
    process.env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL,
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID:
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
});

/** Public, browser-safe environment. Only NEXT_PUBLIC_* values belong here. */
export const env = {
  ...parsed,
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL:
    parsed.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL !== undefined &&
    parsed.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL.length > 0
      ? parsed.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL
      : defaultArcExplorerUrl(parsed.NEXT_PUBLIC_ARC_CHAIN_ID),
};
