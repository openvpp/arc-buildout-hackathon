import { z } from 'zod';

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

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),

  CIRCLE_API_KEY: z.string().optional(),
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
  ARC_RPC_URL: z.string().optional(),
  ARC_AUTH_TOKEN: z.string().optional(),
  ARC_CHAIN_ID: z.string().default('5042002'),
  DEVICE_NFT_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  PRIVATE_KEY: z.string().optional(),
  DEVICE_NFT_MINTER_PRIVATE_KEY: z.string().optional(),
  DEVICE_NFT_TYPE_ID: z.string().default('1'),
  ARC_REQUIRED_CONFIRMATIONS: z.coerce.number().default(3),

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
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  cached = parsed.data;
  return cached;
}
