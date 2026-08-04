import { z } from 'zod';

/**
 * Validated environment configuration.
 *
 * This is the ONLY module permitted to read `process.env` directly (enforced by
 * ESLint). Everything else imports the typed, validated `env` object below.
 *
 * Rules:
 *  - Every variable is `NEXT_PUBLIC_*` and therefore PUBLIC. Never add a secret
 *    here — secrets belong to the separate backend service, never the browser.
 *  - Variables are read via static `process.env.NEXT_PUBLIC_*` member access so
 *    Next.js can inline them into the client bundle. Dynamic access
 *    (`process.env[key]`) would break client-side inlining.
 *  - Validation runs at module load. A missing/invalid value throws immediately,
 *    failing the build or boot fast and loudly rather than at some later call.
 *
 * To add a variable safely:
 *  1. Add it to `.env.example` (documentation) and `.env` (public default).
 *  2. Add a field to `envSchema` with a precise validator.
 *  3. Add it to `readRawEnv()` using static member access.
 *  4. Consume it via `env`, never via `process.env`.
 */

export const APP_ENV_VALUES = [
  'development',
  'test',
  'staging',
  'production',
] as const;

export type AppEnv = (typeof APP_ENV_VALUES)[number];

export const envSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z
    .string()
    .min(1, 'NEXT_PUBLIC_APP_NAME must not be empty'),
  NEXT_PUBLIC_APP_ENV: z.enum(APP_ENV_VALUES),
  NEXT_PUBLIC_API_BASE_URL: z.url(
    'NEXT_PUBLIC_API_BASE_URL must be a valid URL',
  ),
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: z.url(
    'NEXT_PUBLIC_ARC_EXPLORER_BASE_URL must be a valid URL',
  ),
  /** Empty = Web3Auth UI disabled (CI / local without Client ID). */
  NEXT_PUBLIC_WEB3AUTH_CLIENT_ID: z.string().default(''),
  NEXT_PUBLIC_WEB3AUTH_NETWORK: z
    .enum(['sapphire_devnet', 'sapphire_mainnet'])
    .default('sapphire_devnet'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Raw, unvalidated environment values.
 *
 * Exported as a type so `parseEnv` can be unit-tested deterministically with
 * controlled inputs, independent of the real `process.env`.
 */
export type RawEnv = Record<keyof Env, string | undefined>;

function readRawEnv(): RawEnv {
  // Static member access is required for Next.js client inlining. Do not
  // refactor to dynamic indexing.
  return {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_ARC_EXPLORER_BASE_URL:
      process.env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL,
    NEXT_PUBLIC_WEB3AUTH_CLIENT_ID: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID,
    NEXT_PUBLIC_WEB3AUTH_NETWORK: process.env.NEXT_PUBLIC_WEB3AUTH_NETWORK,
  };
}

/**
 * Pure, testable validation of a raw environment object.
 * Throws an aggregated, readable error when validation fails.
 */
export function parseEnv(raw: RawEnv): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');

    throw new Error(
      `Invalid environment configuration. Fix the following and restart:\n${details}`,
    );
  }

  return result.data;
}

export const env: Env = parseEnv(readRawEnv());

export const isProduction = env.NEXT_PUBLIC_APP_ENV === 'production';
export const isDevelopment = env.NEXT_PUBLIC_APP_ENV === 'development';
export const isTest = env.NEXT_PUBLIC_APP_ENV === 'test';
