import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * These are intentionally conservative and framework-compatible. The frontend
 * is a standalone dashboard: it holds no secrets and is never the source of
 * truth for payments, telemetry freshness, or blockchain verification.
 *
 * `Content-Security-Policy` is deliberately omitted here because a correct,
 * non-breaking policy depends on the (not-yet-integrated) backend origin and
 * runtime script strategy. It is tracked as a Phase 2 hardening task in
 * `docs/architecture.md` rather than shipped as a permissive placeholder.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Typed routes are disabled so `pnpm typecheck` can run BEFORE `pnpm build`:
  // when enabled, Next writes an import of the generated `.next/types/routes.d.ts`
  // into `next-env.d.ts`, which does not exist on a fresh checkout. Re-enable in
  // a later phase if the CI/typecheck ordering is adjusted to generate types
  // first.
  typedRoutes: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders],
      },
    ];
  },
};

export default nextConfig;
