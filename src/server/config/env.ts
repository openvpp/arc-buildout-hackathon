import { z } from 'zod';

/**
 * Server-only environment configuration.
 *
 * This is the ONLY backend module permitted to read `process.env` for secrets
 * and infrastructure settings (enforced by ESLint). Frontend public env stays in
 * `src/config/env.ts`.
 *
 * Validation is lazy via `getServerEnv()` so Next.js client/module graphs and
 * frontend unit tests do not require database or blockchain credentials at
 * import time. Production mode rejects mock adapters and unsafe defaults.
 */

export const SERVER_APP_ENV_VALUES = [
  'development',
  'test',
  'demo',
  'staging',
  'production',
] as const;

export type ServerAppEnv = (typeof SERVER_APP_ENV_VALUES)[number];

const ethereumAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 20-byte hex address');

const optionalUrl = z.union([z.url(), z.literal('')]).optional();

export const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    APP_ENV: z.enum(SERVER_APP_ENV_VALUES).default('development'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (value) =>
          value.startsWith('postgres://') || value.startsWith('postgresql://'),
        'DATABASE_URL must be a postgres connection string',
      ),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(20_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30_000),
    DATABASE_SSL_MODE: z
      .enum(['disable', 'prefer', 'require'])
      .default('disable'),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    API_KEY_HASH_SECRET: z
      .string()
      .min(32, 'API_KEY_HASH_SECRET must be at least 32 characters'),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    WEBHOOK_MAX_BODY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(1_048_576),

    TELEMETRY_PRICE_USDC_ATOMIC: z
      .string()
      .regex(/^\d+$/, 'must be a positive atomic integer string')
      .refine((value) => BigInt(value) > 0n, 'must be > 0')
      .default('400'),
    PAYMENT_REQUIREMENT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    PAYMENT_PROTOCOL_VERSION: z.string().min(1).default('1.0.0'),
    PROVENANCE_DELIVERY_MODE: z.enum(['strict', 'pending']).default('strict'),

    AGENT_RATE_LIMIT_PER_WINDOW: z.coerce.number().int().positive().default(60),
    AGENT_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),

    WEB3AUTH_CLIENT_ID: z.string().optional(),
    WEB3AUTH_JWKS_URLS: z.string().optional(),

    SELLER_WALLET_ADDRESS: ethereumAddress.optional(),
    ARC_RPC_URL: optionalUrl,
    ARC_RPC_FALLBACK_URL: optionalUrl,
    ARC_CHAIN_ID: z.coerce.number().int().nonnegative().optional(),
    ARC_BLOCK_EXPLORER_BASE_URL: optionalUrl,
    ARC_USDC_CONTRACT_ADDRESS: ethereumAddress.optional(),
    ARC_REQUIRED_CONFIRMATIONS: z.coerce.number().int().positive().default(3),
    ARC_AUTH_TOKEN: z.string().optional(),
    USE_ARC_NETWORK: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CIRCLE_GATEWAY_FACILITATOR_URL: optionalUrl,
    CIRCLE_GATEWAY_AUTH_TOKEN: z.string().optional(),
    CIRCLE_GATEWAY_WALLET_ADDRESS: ethereumAddress.optional(),
    ARC_PAYMENT_SIGNER_PRIVATE_KEY: z.string().optional(),
    ARC_GATEWAY_AUTO_DEPOSIT_AMOUNT: z.string().optional(),
    AGENT_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
    AGENT_API_BASE_URL: optionalUrl,
    AGENT_API_KEY: z.string().optional(),
    DEVICE_NFT_CONTRACT_ADDRESS: ethereumAddress.optional(),
    DEVICE_NFT_MINTER_PRIVATE_KEY: z.string().optional(),
    /** ovpp-backend alias for DeviceNFTOwnerWallet / minter. */
    PRIVATE_KEY: z.string().optional(),
    DEVICE_NFT_TYPE_ID: z.coerce.number().int().nonnegative().default(1),

    ENODE_API_BASE_URL: optionalUrl,
    ENODE_OAUTH_TOKEN_URL: optionalUrl,
    ENODE_API_VERSION: z.string().optional(),
    ENODE_CLIENT_ID: z.string().optional(),
    ENODE_CLIENT_SECRET: z.string().optional(),
    ENODE_REDIRECT_URI: optionalUrl,
    ENODE_FRONTEND_URL: optionalUrl,
    ENODE_WEBHOOK_SECRET: z.string().optional(),
    ENODE_WEBHOOK_ALLOWED_IPS: z.string().optional(),
    PENDING_DEVICE_OAUTH_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(24),

    ALLOW_MOCK_ADAPTERS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /** Super-admin login (form). Both empty = admin disabled (fail closed). */
    ADMIN_USERNAME: z.string().optional(),
    ADMIN_PASSWORD: z.string().optional(),

    WORKER_ID: z.string().min(1).default('worker-1'),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),

    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
      if (env.ALLOW_MOCK_ADAPTERS) {
        ctx.addIssue({
          code: 'custom',
          path: ['ALLOW_MOCK_ADAPTERS'],
          message: 'Mock adapters are forbidden in production/staging',
        });
      }

      if (
        env.DATABASE_URL.includes('/postgres_test') ||
        env.DATABASE_URL.includes('localhost') ||
        env.DATABASE_URL.includes('127.0.0.1')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message:
            'Production/staging must not use a local or test database URL',
        });
      }

      if (
        env.ARC_PAYMENT_SIGNER_PRIVATE_KEY !== undefined &&
        env.ARC_PAYMENT_SIGNER_PRIVATE_KEY.length > 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['ARC_PAYMENT_SIGNER_PRIVATE_KEY'],
          message:
            'Raw buyer private keys are forbidden in production/staging environment variables',
        });
      }

      if (
        env.DEVICE_NFT_MINTER_PRIVATE_KEY !== undefined &&
        env.DEVICE_NFT_MINTER_PRIVATE_KEY.length > 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEVICE_NFT_MINTER_PRIVATE_KEY'],
          message:
            'Raw DeviceNFT minter private keys are forbidden in production/staging environment variables',
        });
      }

      if (env.PRIVATE_KEY !== undefined && env.PRIVATE_KEY.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['PRIVATE_KEY'],
          message:
            'Raw PRIVATE_KEY is forbidden in production/staging environment variables',
        });
      }

      if (env.ARC_REQUIRED_CONFIRMATIONS < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['ARC_REQUIRED_CONFIRMATIONS'],
          message: 'Confirmation count must be positive',
        });
      }
    }

    if (
      env.SELLER_WALLET_ADDRESS !== undefined &&
      env.SELLER_WALLET_ADDRESS.toLowerCase() ===
        '0x0000000000000000000000000000000000000000'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['SELLER_WALLET_ADDRESS'],
        message: 'Seller wallet must not be the zero address',
      });
    }

    if (!env.ALLOW_MOCK_ADAPTERS) {
      if (
        env.SELLER_WALLET_ADDRESS === undefined ||
        env.SELLER_WALLET_ADDRESS.length === 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['SELLER_WALLET_ADDRESS'],
          message:
            'SELLER_WALLET_ADDRESS is required when ALLOW_MOCK_ADAPTERS is false',
        });
      }

      if (
        env.SELLER_WALLET_ADDRESS !== undefined &&
        env.SELLER_WALLET_ADDRESS.toLowerCase() ===
          '0x1111111111111111111111111111111111111111'
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['SELLER_WALLET_ADDRESS'],
          message:
            'Demo seller wallet 0x1111… is forbidden when mock adapters are disabled',
        });
      }
    }

    const adminUser = env.ADMIN_USERNAME?.trim() ?? '';
    const adminPass = env.ADMIN_PASSWORD ?? '';
    const adminUserSet = adminUser.length > 0;
    const adminPassSet = adminPass.length > 0;
    if (adminUserSet !== adminPassSet) {
      ctx.addIssue({
        code: 'custom',
        path: adminUserSet ? ['ADMIN_PASSWORD'] : ['ADMIN_USERNAME'],
        message:
          'ADMIN_USERNAME and ADMIN_PASSWORD must both be set or both omitted',
      });
    }
    if (adminPassSet && adminPass.length < 8) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_PASSWORD'],
        message: 'ADMIN_PASSWORD must be at least 8 characters when set',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type RawServerEnv = {
  readonly [K in keyof z.input<typeof serverEnvSchema>]?: string | undefined;
};

export function readRawServerEnv(
  source: NodeJS.ProcessEnv = process.env,
): RawServerEnv {
  return {
    NODE_ENV: source.NODE_ENV,
    APP_ENV: source.APP_ENV,
    DATABASE_URL: source.DATABASE_URL,
    DATABASE_POOL_MAX: source.DATABASE_POOL_MAX,
    DATABASE_CONNECTION_TIMEOUT_MS: source.DATABASE_CONNECTION_TIMEOUT_MS,
    DATABASE_IDLE_TIMEOUT_MS: source.DATABASE_IDLE_TIMEOUT_MS,
    DATABASE_STATEMENT_TIMEOUT_MS: source.DATABASE_STATEMENT_TIMEOUT_MS,
    DATABASE_SSL_MODE: source.DATABASE_SSL_MODE,
    LOG_LEVEL: source.LOG_LEVEL,
    API_KEY_HASH_SECRET: source.API_KEY_HASH_SECRET,
    IDEMPOTENCY_TTL_SECONDS: source.IDEMPOTENCY_TTL_SECONDS,
    WEBHOOK_MAX_BODY_BYTES: source.WEBHOOK_MAX_BODY_BYTES,
    TELEMETRY_PRICE_USDC_ATOMIC: source.TELEMETRY_PRICE_USDC_ATOMIC,
    PAYMENT_REQUIREMENT_TTL_SECONDS: source.PAYMENT_REQUIREMENT_TTL_SECONDS,
    PAYMENT_PROTOCOL_VERSION: source.PAYMENT_PROTOCOL_VERSION,
    PROVENANCE_DELIVERY_MODE: source.PROVENANCE_DELIVERY_MODE,
    AGENT_RATE_LIMIT_PER_WINDOW: source.AGENT_RATE_LIMIT_PER_WINDOW,
    AGENT_RATE_LIMIT_WINDOW_SECONDS: source.AGENT_RATE_LIMIT_WINDOW_SECONDS,
    WEB3AUTH_CLIENT_ID:
      source.WEB3AUTH_CLIENT_ID ?? source.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID,
    WEB3AUTH_JWKS_URLS: source.WEB3AUTH_JWKS_URLS,
    SELLER_WALLET_ADDRESS: source.SELLER_WALLET_ADDRESS,
    ARC_RPC_URL: source.ARC_RPC_URL,
    ARC_RPC_FALLBACK_URL: source.ARC_RPC_FALLBACK_URL,
    ARC_CHAIN_ID: source.ARC_CHAIN_ID,
    ARC_BLOCK_EXPLORER_BASE_URL: source.ARC_BLOCK_EXPLORER_BASE_URL,
    ARC_USDC_CONTRACT_ADDRESS: source.ARC_USDC_CONTRACT_ADDRESS,
    ARC_REQUIRED_CONFIRMATIONS: source.ARC_REQUIRED_CONFIRMATIONS,
    ARC_AUTH_TOKEN: source.ARC_AUTH_TOKEN,
    USE_ARC_NETWORK: source.USE_ARC_NETWORK,
    CIRCLE_GATEWAY_FACILITATOR_URL: source.CIRCLE_GATEWAY_FACILITATOR_URL,
    CIRCLE_GATEWAY_AUTH_TOKEN: source.CIRCLE_GATEWAY_AUTH_TOKEN,
    CIRCLE_GATEWAY_WALLET_ADDRESS: source.CIRCLE_GATEWAY_WALLET_ADDRESS,
    ARC_PAYMENT_SIGNER_PRIVATE_KEY: source.ARC_PAYMENT_SIGNER_PRIVATE_KEY,
    ARC_GATEWAY_AUTO_DEPOSIT_AMOUNT: source.ARC_GATEWAY_AUTO_DEPOSIT_AMOUNT,
    AGENT_POLL_INTERVAL_SECONDS: source.AGENT_POLL_INTERVAL_SECONDS,
    AGENT_API_BASE_URL: source.AGENT_API_BASE_URL,
    AGENT_API_KEY: source.AGENT_API_KEY,
    DEVICE_NFT_CONTRACT_ADDRESS: source.DEVICE_NFT_CONTRACT_ADDRESS,
    DEVICE_NFT_MINTER_PRIVATE_KEY: source.DEVICE_NFT_MINTER_PRIVATE_KEY,
    PRIVATE_KEY: source.PRIVATE_KEY,
    DEVICE_NFT_TYPE_ID: source.DEVICE_NFT_TYPE_ID,
    ENODE_API_BASE_URL: source.ENODE_API_BASE_URL,
    ENODE_OAUTH_TOKEN_URL: source.ENODE_OAUTH_TOKEN_URL,
    ENODE_API_VERSION: source.ENODE_API_VERSION,
    ENODE_CLIENT_ID: source.ENODE_CLIENT_ID,
    ENODE_CLIENT_SECRET: source.ENODE_CLIENT_SECRET,
    ENODE_REDIRECT_URI: source.ENODE_REDIRECT_URI,
    ENODE_FRONTEND_URL: source.ENODE_FRONTEND_URL,
    ENODE_WEBHOOK_SECRET: source.ENODE_WEBHOOK_SECRET,
    ENODE_WEBHOOK_ALLOWED_IPS: source.ENODE_WEBHOOK_ALLOWED_IPS,
    PENDING_DEVICE_OAUTH_TTL_HOURS: source.PENDING_DEVICE_OAUTH_TTL_HOURS,
    ALLOW_MOCK_ADAPTERS: source.ALLOW_MOCK_ADAPTERS,
    ADMIN_USERNAME: source.ADMIN_USERNAME,
    ADMIN_PASSWORD: source.ADMIN_PASSWORD,
    WORKER_ID: source.WORKER_ID,
    WORKER_POLL_INTERVAL_MS: source.WORKER_POLL_INTERVAL_MS,
    WORKER_CONCURRENCY: source.WORKER_CONCURRENCY,
    WORKER_MAX_ATTEMPTS: source.WORKER_MAX_ATTEMPTS,
    OTEL_EXPORTER_OTLP_ENDPOINT: source.OTEL_EXPORTER_OTLP_ENDPOINT,
    SENTRY_DSN: source.SENTRY_DSN,
  };
}

export function parseServerEnv(raw: RawServerEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');

    throw new Error(
      `Invalid server environment configuration. Fix the following and restart:\n${details}`,
    );
  }

  return result.data;
}

let cachedServerEnv: ServerEnv | undefined;

/**
 * Lazily parse and cache server environment. Safe to call from Route Handlers
 * and the worker process. Does not throw until first invocation.
 */
export function getServerEnv(): ServerEnv {
  if (cachedServerEnv === undefined) {
    cachedServerEnv = parseServerEnv(readRawServerEnv());
  }
  return cachedServerEnv;
}

/** Test-only: clear the cached env so the next call re-parses. */
export function resetServerEnvCache(): void {
  cachedServerEnv = undefined;
}

export function isServerProduction(env: ServerEnv = getServerEnv()): boolean {
  return env.APP_ENV === 'production';
}

export function isServerDemo(env: ServerEnv = getServerEnv()): boolean {
  return env.APP_ENV === 'demo';
}

/**
 * Super-admin credentials, or null when admin is not configured
 * (both username and password unset/empty).
 */
export function getAdminBasicCredentials(
  env: ServerEnv = getServerEnv(),
): { readonly username: string; readonly password: string } | null {
  const username = env.ADMIN_USERNAME?.trim() ?? '';
  const password = env.ADMIN_PASSWORD ?? '';
  if (username.length === 0 || password.length === 0) {
    return null;
  }
  return { username, password };
}
