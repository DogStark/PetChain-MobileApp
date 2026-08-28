import config from '../config';

/* eslint-disable no-console */

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
type LogMetadata = Record<string, unknown>;

class Logger {
  private readonly enabled = config.isDev || config.isStaging;

  log(message: string, metadata?: LogMetadata): void {
    this.write('log', message, metadata);
  }

  info(message: string, metadata?: LogMetadata): void {
    this.write('info', message, metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.write('warn', message, metadata);
  }

  error(message: string, metadata?: LogMetadata): void {
    this.write('error', message, metadata);
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.write('debug', message, metadata);
  }

  private write(level: LogLevel, message: string, metadata?: LogMetadata): void {
    if (!this.enabled) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...(metadata ? { metadata } : {}),
    };

    console[level](entry);
  }
}

const logger = new Logger();

export default logger;
