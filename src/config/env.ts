import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().default(''),
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: z
    .string()
    .default('https://testnet.arcscan.app'),
  // Google OAuth client id for the sign-in button. The server verifies
  // the ID token audience against this same value. If unset, the button
  // is hidden and sign-in is unavailable.
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
});

/** Public, browser-safe environment. Only NEXT_PUBLIC_* values belong here. */
export const env = publicEnvSchema.parse({
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL:
    process.env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL,
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID:
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
});
