import pino, { type Logger as PinoLogger } from 'pino';

import { getServerEnv } from '@/server/config/env';

export type ServerLogBindings = Record<string, unknown>;

const REDACT_PATHS = [
  'apiKey',
  'authorization',
  'headers.authorization',
  'headers.Authorization',
  'ENODE_CLIENT_SECRET',
  'ENODE_WEBHOOK_SECRET',
  'API_KEY_HASH_SECRET',
  'DATABASE_URL',
  'password',
  'secret',
  'token',
  'privateKey',
  'seed',
  'mnemonic',
  'rawPayload',
  'raw_payload',
];

let rootLogger: PinoLogger | undefined;

function getRootLogger(): PinoLogger {
  if (rootLogger === undefined) {
    let level = 'info';
    try {
      level = getServerEnv().LOG_LEVEL;
    } catch {
      level = 'info';
    }

    rootLogger = pino({
      level,
      redact: {
        paths: REDACT_PATHS,
        censor: '[redacted]',
      },
      base: {
        service: 'ev-telemetry-backend',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return rootLogger;
}

export type ServerLogger = {
  debug(message: string, bindings?: ServerLogBindings): void;
  info(message: string, bindings?: ServerLogBindings): void;
  warn(message: string, bindings?: ServerLogBindings): void;
  error(message: string, bindings?: ServerLogBindings): void;
  child(bindings: ServerLogBindings): ServerLogger;
};

function wrap(logger: PinoLogger): ServerLogger {
  return {
    debug: (message, bindings) => {
      logger.debug(bindings ?? {}, message);
    },
    info: (message, bindings) => {
      logger.info(bindings ?? {}, message);
    },
    warn: (message, bindings) => {
      logger.warn(bindings ?? {}, message);
    },
    error: (message, bindings) => {
      logger.error(bindings ?? {}, message);
    },
    child: (bindings) => wrap(logger.child(bindings)),
  };
}

export function createServerLogger(
  bindings: ServerLogBindings = {},
): ServerLogger {
  const base = getRootLogger();
  return Object.keys(bindings).length > 0
    ? wrap(base.child(bindings))
    : wrap(base);
}

/** Test helper to reset the singleton between suites. */
export function resetServerLogger(): void {
  rootLogger = undefined;
}
