type LogFields = Record<string, unknown>;

/** Client-side logger. Use instead of console.* in application code. */
export const logger = {
  debug(event: string, fields?: LogFields): void {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- this module is the sanctioned logging sink
      console.debug(event, fields ?? {});
    }
  },
  info(event: string, fields?: LogFields): void {
    // eslint-disable-next-line no-console -- this module is the sanctioned logging sink
    console.info(event, fields ?? {});
  },
  warn(event: string, fields?: LogFields): void {
    console.warn(event, fields ?? {});
  },
  error(event: string, fields?: LogFields): void {
    console.error(event, fields ?? {});
  },
};
