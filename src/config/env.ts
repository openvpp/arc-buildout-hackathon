import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().default(''),
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: z
    .string()
    .default('https://testnet.arcscan.app'),
});

/** Public, browser-safe environment. Only NEXT_PUBLIC_* values belong here. */
export const env = publicEnvSchema.parse({
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID:
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL:
    process.env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL,
});
