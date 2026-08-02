# Security

## Secrets

- No secrets in git, `NEXT_PUBLIC_*`, frontend bundles, or logs
- API keys stored as HMAC-SHA256 hashes with `API_KEY_HASH_SECRET`
- Wallet private keys / seed phrases never stored in the frontend
- `ARC_PAYMENT_SIGNER_PRIVATE_KEY` allowed only in development/demo/test;
  forbidden in production/staging (production buyer signing needs KMS/reference)
- Production rejects `ALLOW_MOCK_ADAPTERS=true`

## API

- Validate all external input with Zod
- Stable error codes; no stack traces/SQL/secrets in responses
- Authorization in the application layer (not only UI navigation)
- Prefer `404` over `403` for resource enumeration where documented
- Idempotency for financial writes (ledger / delivery constraints)
- Rate-limit bucket table + helper exist under
  `src/server/infrastructure/rate-limit/` — **not yet mounted** on agent routes;
  do not claim production rate limiting until wired

## Headers

Existing Next security headers remain. CORS stays narrow; API-key agents are
server-to-server and do not rely on CORS for security.

## Logging

Pino with redaction paths for secrets, auth headers, and raw webhook payloads.
