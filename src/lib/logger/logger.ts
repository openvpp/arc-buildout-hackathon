import { isProduction } from '@/config/env';

/**
 * Typed logging abstraction.
 *
 * Application code logs through this module instead of `console.*` (enforced by
 * ESLint). The transport is a swappable `LoggerSink`, so a future observability
 * provider (Sentry, OpenTelemetry, Datadog, ...) can be dropped in without
 * touching call sites. No such SDK is installed in Phase 1.
 *
 * Safety:
 *  - Metadata is redacted for well-known sensitive keys before it is emitted.
 *  - Never pass private keys, seed phrases, secrets, full wallet payloads, or
 *    sensitive headers into a log call. Redaction is a safety net, not a
 *    licence to log sensitive data.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogMetadata = Record<string, unknown>;

export type LogRecord = {
  readonly level: LogLevel;
  readonly message: string;
  readonly time: string;
  readonly metadata?: LogMetadata;
};

export type Logger = {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  /** Returns a logger that merges `bindings` into every record's metadata. */
  child(bindings: LogMetadata): Logger;
};

/**
 * The replaceable transport. Implement this to forward records to an external
 * observability backend. Keep it side-effect free beyond emitting the record.
 */
export type LoggerSink = {
  write(record: LogRecord): void;
};

const REDACTED = '[redacted]';

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|seed|mnemonic|passphrase)/i;

/**
 * Shallow-redact obviously sensitive keys. Intentionally shallow: logs should
 * carry small, purposeful metadata, not deep object graphs.
 */
export function redactMetadata(metadata: LogMetadata): LogMetadata {
  const out: LogMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return out;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// In production, drop noisy debug logs. Everything else is emitted.
const MIN_LEVEL: LogLevel = isProduction ? 'info' : 'debug';

/**
 * Default sink. Uses the console transport intentionally — this is the one
 * infrastructure module permitted to touch `console` (see ESLint overrides).
 */
export const consoleSink: LoggerSink = {
  write(record: LogRecord): void {
    const payload =
      record.metadata !== undefined
        ? { message: record.message, ...record.metadata }
        : { message: record.message };

    switch (record.level) {
      case 'debug':
      case 'info':
        // eslint-disable-next-line no-console -- infrastructure transport
        console.log(`[${record.time}] ${record.level}`, payload);
        return;
      case 'warn':
        // eslint-disable-next-line no-console -- infrastructure transport
        console.warn(`[${record.time}] warn`, payload);
        return;
      case 'error':
        // eslint-disable-next-line no-console -- infrastructure transport
        console.error(`[${record.time}] error`, payload);
        return;
    }
  },
};

function emit(
  sink: LoggerSink,
  bindings: LogMetadata,
  level: LogLevel,
  message: string,
  metadata?: LogMetadata,
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  const merged: LogMetadata = { ...bindings, ...(metadata ?? {}) };
  const hasMeta = Object.keys(merged).length > 0;

  sink.write({
    level,
    message,
    time: new Date().toISOString(),
    ...(hasMeta ? { metadata: redactMetadata(merged) } : {}),
  });
}

export function createLogger(
  sink: LoggerSink = consoleSink,
  bindings: LogMetadata = {},
): Logger {
  return {
    debug: (message, metadata) =>
      emit(sink, bindings, 'debug', message, metadata),
    info: (message, metadata) =>
      emit(sink, bindings, 'info', message, metadata),
    warn: (message, metadata) =>
      emit(sink, bindings, 'warn', message, metadata),
    error: (message, metadata) =>
      emit(sink, bindings, 'error', message, metadata),
    child: (childBindings) =>
      createLogger(sink, { ...bindings, ...childBindings }),
  };
}

/** Default application logger. Swap the sink here to wire an observability provider. */
export const logger: Logger = createLogger();
