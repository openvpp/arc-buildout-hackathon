import { z } from 'zod';

import { arcNetworkFor, defaultArcRpcUrl } from '@/config/arc-network';

const boolFromString = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const serverEnvSchema = z.object({
  APP_ENV: z
    .enum(['development', 'test', 'demo', 'staging', 'production'])
    .default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ALLOW_MOCK_ADAPTERS: boolFromString,

  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  DATABASE_SSL_MODE: z.enum(['disable', 'require']).default('disable'),

  API_KEY_HASH_SECRET: z.string().min(16),

  // Public OAuth client id. Same value as NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.
  // Used as the ID token `aud` check. Empty disables Google sign-in.
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),

  CIRCLE_API_KEY: z.string().optional(),
  // Informational only — Circle infers sandbox/production from the
  // CIRCLE_API_KEY prefix (TEST_API_KEY: vs LIVE_API_KEY:) itself; kept here
  // so it's validated/documented alongside the other Circle config.
  CIRCLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
  CIRCLE_WALLET_SET_ID: z.string().optional(),
  CIRCLE_WALLET_BLOCKCHAIN: z.string().default('ARC-TESTNET'),

  ENODE_API_BASE_URL: z.string().optional(),
  ENODE_OAUTH_TOKEN_URL: z.string().optional(),
  ENODE_API_VERSION: z.string().optional(),
  ENODE_CLIENT_ID: z.string().optional(),
  ENODE_CLIENT_SECRET: z.string().optional(),
  ENODE_REDIRECT_URI: z.string().optional(),
  ENODE_FRONTEND_URL: z.string().optional(),
  ENODE_WEBHOOK_SECRET: z.string().optional(),
  PENDING_DEVICE_OAUTH_TTL_HOURS: z.coerce.number().default(1),

  USE_ARC_NETWORK: boolFromString,
  // Optional: Arc's public RPC for the chain is used when unset.
  ARC_RPC_URL: z.string().optional(),
  // Optional separate RPC for independent verification reads, so checking
  // an event does not rely on the provider that wrote it.
  VERIFIER_RPC_URL: z.string().optional(),
  // Optional explorer API (Blockscout) used only to discover past events.
  ARC_EXPLORER_API_URL: z.string().optional(),
  ARC_AUTH_TOKEN: z.string().optional(),
  ARC_CHAIN_ID: z.string().default('5042002'),
  DEVICE_NFT_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  PRIVATE_KEY: z.string().optional(),
  DEVICE_NFT_MINTER_PRIVATE_KEY: z.string().optional(),
  ARC_REQUIRED_CONFIRMATIONS: z.coerce.number().default(3),
  // Configured tariff (USD/kWh) used for a charging session's cost. Not a
  // measured price — no tariff provider is integrated.
  ELECTRICITY_PRICE_USD_PER_KWH: z.coerce.number().nonnegative().default(0.12),

  // Server-side address geocoding. Falls back to NEXT_PUBLIC_MAPBOX_TOKEN.
  MAPBOX_GEOCODING_TOKEN: z.string().default(''),
  // Mapbox only allows storing geocoding results requested with
  // permanent=true (a billed account option). Must be true wherever
  // device addresses are stored for real.
  MAPBOX_PERMANENT_GEOCODING: boolFromString,
  // Seeds the stable 0.5–2 km offset applied to every public globe pin.
  // Falls back to API_KEY_HASH_SECRET when unset.
  LOCATION_OBFUSCATION_SECRET: z.string().default(''),

  WORKER_ID: z.string().default('local'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().default(5),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Validated server-only environment. Never import this from client code. */
export function getServerEnv(): ServerEnv {
  if (cached !== null) {
    return cached;
  }
  const parsed = serverEnvSchema.safeParse({
    ...process.env,
    GOOGLE_OAUTH_CLIENT_ID:
      process.env.GOOGLE_OAUTH_CLIENT_ID ??
      process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    MAPBOX_GEOCODING_TOKEN:
      // `||`, not `??`: an empty MAPBOX_GEOCODING_TOKEN= line should fall back.
      process.env.MAPBOX_GEOCODING_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  assertProductionSafe(parsed.data);
  assertArcNetworkConfig(parsed.data, process.env.NEXT_PUBLIC_ARC_CHAIN_ID);
  cached = parsed.data;
  return cached;
}

/**
 * Network settings that must agree, checked at startup in every
 * environment: a mismatch here would otherwise surface as a confusing RPC
 * error, a wallet on the wrong chain, or UI naming the wrong network.
 */
export function assertArcNetworkConfig(
  env: Pick<
    ServerEnv,
    | 'ARC_CHAIN_ID'
    | 'ARC_RPC_URL'
    | 'USE_ARC_NETWORK'
    | 'CIRCLE_WALLET_BLOCKCHAIN'
  >,
  publicChainId: string | undefined,
): void {
  if (
    publicChainId !== undefined &&
    publicChainId.length > 0 &&
    publicChainId !== env.ARC_CHAIN_ID
  ) {
    throw new Error(
      `NEXT_PUBLIC_ARC_CHAIN_ID (${publicChainId}) must equal ARC_CHAIN_ID (${env.ARC_CHAIN_ID}).`,
    );
  }
  const hasRpc = env.ARC_RPC_URL !== undefined && env.ARC_RPC_URL.length > 0;
  if (
    env.USE_ARC_NETWORK &&
    !hasRpc &&
    defaultArcRpcUrl(env.ARC_CHAIN_ID) === null
  ) {
    throw new Error(
      `ARC_RPC_URL is required for ARC_CHAIN_ID ${env.ARC_CHAIN_ID} (no public Arc RPC is known for it).`,
    );
  }
  if (
    arcNetworkFor(env.ARC_CHAIN_ID) === 'mainnet' &&
    env.CIRCLE_WALLET_BLOCKCHAIN.toUpperCase().includes('TESTNET')
  ) {
    throw new Error(
      `CIRCLE_WALLET_BLOCKCHAIN (${env.CIRCLE_WALLET_BLOCKCHAIN}) is a testnet chain but ARC_CHAIN_ID is Arc mainnet.`,
    );
  }
}

function assertProductionSafe(env: ServerEnv): void {
  if (env.APP_ENV !== 'production' && env.APP_ENV !== 'staging') {
    return;
  }
  if (env.ALLOW_MOCK_ADAPTERS) {
    throw new Error(
      'ALLOW_MOCK_ADAPTERS must be false when APP_ENV is production or staging.',
    );
  }
  if (env.API_KEY_HASH_SECRET.length < 32) {
    throw new Error(
      'API_KEY_HASH_SECRET must be at least 32 characters when APP_ENV is production or staging.',
    );
  }
}
