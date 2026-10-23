type LogFields = Record<string, unknown>;

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

function currentThreshold(): Level {
  const level = process.env.LOG_LEVEL;
  return LEVELS.includes(level as Level) ? (level as Level) : 'info';
}

function shouldLog(level: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(currentThreshold());
}

/** An http(s) URL: scheme + host, then any path, query or fragment. */
const URL_PATTERN = /(https?:\/\/[^\s/?#"'<>]+)[^\s"'<>]*/gi;

/**
 * Keeps a URL's origin and drops its path and query, where provider API
 * keys and tokens live (e.g. an RPC URL echoed in a viem error message).
 * Applied to every string a log line carries.
 */
export function redactUrls(value: string): string {
  return value.replace(URL_PATTERN, (match, origin: string) =>
    match.length > origin.length ? `${origin}/[redacted]` : origin,
  );
}

function redactUrlsDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactUrls(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactUrlsDeep);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactUrlsDeep(entry)]),
    );
  }
  return value;
}

export type ServerLogger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

/** Structured JSON logger for backend/application code. */
export function createServerLogger(context: LogFields = {}): ServerLogger {
  function log(level: Level, event: string, fields: LogFields = {}): void {
    if (!shouldLog(level)) {
      return;
    }
    const line = JSON.stringify(
      redactUrlsDeep({
        level,
        event,
        timestamp: new Date().toISOString(),
        ...context,
        ...fields,
      }),
    );
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      // eslint-disable-next-line no-console -- this module is the sanctioned logging sink
      console.log(line);
    }
  }

  return {
    debug: (event, fields) => {
      log('debug', event, fields);
    },
    info: (event, fields) => {
      log('info', event, fields);
    },
    warn: (event, fields) => {
      log('warn', event, fields);
    },
    error: (event, fields) => {
      log('error', event, fields);
    },
  };
}
