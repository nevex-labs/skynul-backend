import pino from 'pino';

const level = process.env.SKYNUL_LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level,
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } : undefined,
  base: undefined, // no pid/hostname noise
});

/** Create a child logger with fixed context fields. */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
