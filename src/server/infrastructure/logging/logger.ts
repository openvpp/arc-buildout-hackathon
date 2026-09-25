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
    const line = JSON.stringify({
      level,
      event,
      timestamp: new Date().toISOString(),
      ...context,
      ...fields,
    });
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
