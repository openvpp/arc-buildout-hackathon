import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk, jsonError } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serves the committed OpenAPI 3.1 document for public API surfaces.
 */
export const GET = createRouteHandler(async (_request, context) => {
  try {
    const openapiPath = path.join(process.cwd(), 'openapi', 'openapi.json');
    const raw = await readFile(openapiPath, 'utf8');
    const document: unknown = JSON.parse(raw);
    return jsonOk(document, context.requestId);
  } catch {
    return jsonError(
      new ApiError({
        code: 'INTERNAL_ERROR',
        message: 'OpenAPI document is unavailable.',
        status: 500,
        expose: false,
      }),
      context.requestId,
    );
  }
});
