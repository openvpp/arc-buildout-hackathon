/**
 * Fail-fast environment verification for local/demo/prod boot checks.
 */
import { parseServerEnv, readRawServerEnv } from '../src/server/config/env';

try {
  const env = parseServerEnv(readRawServerEnv());
  console.log(
    JSON.stringify(
      {
        ok: true,
        appEnv: env.APP_ENV,
        allowMockAdapters: env.ALLOW_MOCK_ADAPTERS,
        provenanceMode: env.PROVENANCE_DELIVERY_MODE,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
