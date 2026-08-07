/**
 * Ambient augmentation of `process.env` with known public and server keys.
 *
 * Public NEXT_PUBLIC_* keys remain named for Next.js client inlining.
 * Server keys are optional ambient types for backend modules and scripts.
 */
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NEXT_PUBLIC_APP_NAME?: string;
      readonly NEXT_PUBLIC_APP_ENV?: string;
      readonly NEXT_PUBLIC_API_BASE_URL?: string;
      readonly NEXT_PUBLIC_ARC_EXPLORER_BASE_URL?: string;
      readonly NEXT_PUBLIC_WEB3AUTH_CLIENT_ID?: string;
      readonly NEXT_PUBLIC_WEB3AUTH_NETWORK?: string;

      readonly NODE_ENV?: string;
      readonly APP_ENV?: string;
      readonly DATABASE_URL?: string;
      readonly DATABASE_POOL_MAX?: string;
      readonly DATABASE_CONNECTION_TIMEOUT_MS?: string;
      readonly DATABASE_IDLE_TIMEOUT_MS?: string;
      readonly DATABASE_STATEMENT_TIMEOUT_MS?: string;
      readonly DATABASE_SSL_MODE?: string;
      readonly LOG_LEVEL?: string;
      readonly API_KEY_HASH_SECRET?: string;
      readonly IDEMPOTENCY_TTL_SECONDS?: string;
      readonly WEBHOOK_MAX_BODY_BYTES?: string;
      readonly TELEMETRY_PRICE_USDC_ATOMIC?: string;
      readonly PAYMENT_REQUIREMENT_TTL_SECONDS?: string;
      readonly PAYMENT_PROTOCOL_VERSION?: string;
      readonly PROVENANCE_DELIVERY_MODE?: string;
      readonly AGENT_RATE_LIMIT_PER_WINDOW?: string;
      readonly AGENT_RATE_LIMIT_WINDOW_SECONDS?: string;
      readonly WEB3AUTH_CLIENT_ID?: string;
      readonly WEB3AUTH_JWKS_URLS?: string;
      readonly SELLER_WALLET_ADDRESS?: string;
      readonly ARC_RPC_URL?: string;
      readonly ARC_RPC_FALLBACK_URL?: string;
      readonly ARC_CHAIN_ID?: string;
      readonly ARC_BLOCK_EXPLORER_BASE_URL?: string;
      readonly ARC_USDC_CONTRACT_ADDRESS?: string;
      readonly ARC_REQUIRED_CONFIRMATIONS?: string;
      readonly ARC_AUTH_TOKEN?: string;
      readonly USE_ARC_NETWORK?: string;
      readonly CIRCLE_GATEWAY_FACILITATOR_URL?: string;
      readonly CIRCLE_GATEWAY_AUTH_TOKEN?: string;
      readonly CIRCLE_GATEWAY_WALLET_ADDRESS?: string;
      readonly ARC_PAYMENT_SIGNER_PRIVATE_KEY?: string;
      readonly ARC_GATEWAY_AUTO_DEPOSIT_AMOUNT?: string;
      readonly AGENT_POLL_INTERVAL_SECONDS?: string;
      readonly AGENT_API_BASE_URL?: string;
      readonly AGENT_API_KEY?: string;
      readonly AGENT_WALLET_ADDRESS?: string;
      readonly AGENT_DEVICE_ID?: string;
      readonly DEVICE_NFT_CONTRACT_ADDRESS?: string;
      readonly DEVICE_NFT_MINTER_PRIVATE_KEY?: string;
      readonly PRIVATE_KEY?: string;
      readonly DEVICE_NFT_TYPE_ID?: string;
      readonly ENODE_API_BASE_URL?: string;
      readonly ENODE_OAUTH_TOKEN_URL?: string;
      readonly ENODE_API_VERSION?: string;
      readonly ENODE_CLIENT_ID?: string;
      readonly ENODE_CLIENT_SECRET?: string;
      readonly ENODE_REDIRECT_URI?: string;
      readonly ENODE_FRONTEND_URL?: string;
      readonly ENODE_WEBHOOK_SECRET?: string;
      readonly ENODE_WEBHOOK_ALLOWED_IPS?: string;
      readonly PENDING_DEVICE_OAUTH_TTL_HOURS?: string;
      readonly ALLOW_MOCK_ADAPTERS?: string;
      readonly ADMIN_USERNAME?: string;
      readonly ADMIN_PASSWORD?: string;
      readonly WORKER_ID?: string;
      readonly WORKER_POLL_INTERVAL_MS?: string;
      readonly WORKER_CONCURRENCY?: string;
      readonly WORKER_MAX_ATTEMPTS?: string;
      readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string;
      readonly SENTRY_DSN?: string;
      readonly ALLOW_TEST_DB_RESET?: string;
    }
  }
}

export {};
