import type { NextResponse } from 'next/server';

import { createServerLogger } from '@/server/infrastructure/logging/logger';

import { ApiError, mapUnknownErrorToApiError } from './api-error';
import { jsonError } from './api-response';
import { createRequestContext, type RequestContext } from './request-context';

export type RouteHandler = (
  request: Request,
  context: RequestContext,
) => Promise<NextResponse>;

/**
 * Thin transport wrapper for Route Handlers.
 *
 * Handlers extract/validate input and call one use case. Business logic must
 * not live here. Errors are mapped to the stable API error contract.
 */
export function createRouteHandler(handler: RouteHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const context = createRequestContext(request);
    const log = createServerLogger().child({
      requestId: context.requestId,
      method: context.method,
      route: context.path,
    });

    try {
      const response = await handler(request, context);
      log.info('request.completed', {
        statusCode: response.status,
        durationMs: Date.now() - context.startedAt,
      });
      return response;
    } catch (error) {
      const apiError = mapUnknownErrorToApiError(error);

      if (!(error instanceof ApiError) || apiError.status >= 500) {
        log.error('request.failed', {
          statusCode: apiError.status,
          code: apiError.code,
          durationMs: Date.now() - context.startedAt,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorMessage: error instanceof Error ? error.message : 'unknown',
        });
      } else {
        log.warn('request.rejected', {
          statusCode: apiError.status,
          code: apiError.code,
          durationMs: Date.now() - context.startedAt,
        });
      }

      return jsonError(apiError, context.requestId);
    }
  };
}
