import type { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { createServerLogger } from '@/server/infrastructure/logging/logger';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonError } from '@/server/transport/http/api-response';
import {
  createRequestContext,
  type RequestContext,
} from '@/server/transport/http/request-context';

const log = createServerLogger({ component: 'route-handler' });

type Handler<Params> = (
  request: NextRequest,
  context: RequestContext & { params: Params },
) => Promise<NextResponse>;

/**
 * Wraps a Route Handler so it never leaks raw internal errors and always
 * returns the {ok, data|error, requestId} envelope.
 */
export function createRouteHandler<Params = Record<string, never>>(
  handler: Handler<Params>,
) {
  return async (
    request: NextRequest,
    routeArgs?: { params: Promise<Params> },
  ): Promise<NextResponse> => {
    const context = createRequestContext();
    try {
      const params =
        routeArgs?.params !== undefined
          ? await routeArgs.params
          : ({} as Params);
      return await handler(request, { ...context, params });
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(
          { code: error.code, message: error.message, details: error.details },
          error.status,
          context.requestId,
        );
      }
      if (error instanceof ZodError) {
        return jsonError(
          {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed.',
            details: { issues: error.issues },
          },
          400,
          context.requestId,
        );
      }
      log.error('route.unhandled_error', {
        requestId: context.requestId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return jsonError(
        { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' },
        500,
        context.requestId,
      );
    }
  };
}
