// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: Error;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  maxFileSize: number;
  maxFiles: number;
}

// ─── Default Configuration ────────────────────────────────────────────────────

const DEFAULT_CONFIG: LoggerConfig = {
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  enableConsole: true,
  enableFile: false, // Disabled for React Native compatibility
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
};

// ─── Log Level Priority ───────────────────────────────────────────────────────

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Logger Service ───────────────────────────────────────────────────────────

class LoggerService {
  private config: LoggerConfig;
  private logBuffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Public Logging Methods ───────────────────────────────────────────────────

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log('error', message, context, error);
  }

  // ─── Core Logging Method ──────────────────────────────────────────────────────

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
      return;
    }

    const logEntry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      error,
    };

    this.addToBuffer(logEntry);

    if (this.config.enableConsole) {
      this.logToConsole(logEntry);
    }
  }

  // ─── Console Output ───────────────────────────────────────────────────────────

  private logToConsole(entry: LogEntry): void {
    const { level, message, timestamp, context, error } = entry;
    const formattedMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    const consoleMethod = this.getConsoleMethod(level);

    if (context || error) {
      const additionalData: Record<string, unknown> = {};
      if (context) additionalData.context = context;
      if (error) additionalData.error = { message: error.message, stack: error.stack };
      consoleMethod(formattedMessage, additionalData);
    } else {
      consoleMethod(formattedMessage);
    }
  }

  private getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
    switch (level) {
      case 'debug':
        return console.debug;
      case 'info':
        return console.info;
      case 'warn':
        return console.warn;
      case 'error':
        return console.error;
      default:
        return console.log;
    }
  }

  // ─── Buffer Management ────────────────────────────────────────────────────────

  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
    }
  }

  // ─── Public Utility Methods ───────────────────────────────────────────────────

  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logBuffer.slice(-count);
  }

  getLogsByLevel(level: LogLevel, count: number = 100): LogEntry[] {
    return this.logBuffer.filter((entry) => entry.level === level).slice(-count);
  }

  clearBuffer(): void {
    this.logBuffer = [];
  }

  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  child(context: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, context);
  }
}

// ─── Child Logger ─────────────────────────────────────────────────────────────

class ChildLogger {
  constructor(
    private parent: LoggerService,
    private context: Record<string, unknown>,
  ) {}

  debug(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.debug(message, { ...this.context, ...additionalContext });
  }

  info(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.info(message, { ...this.context, ...additionalContext });
  }

  warn(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.warn(message, { ...this.context, ...additionalContext });
  }

  error(message: string, additionalContext?: Record<string, unknown>, error?: Error): void {
    this.parent.error(message, { ...this.context, ...additionalContext }, error);
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const loggerService = new LoggerService();

export default loggerService;
