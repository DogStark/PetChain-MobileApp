import AsyncStorage from '@react-native-async-storage/async-storage';

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
  enableStorage: boolean;
  maxStorageEntries: number;
}

// ─── Default Configuration ────────────────────────────────────────────────────

const DEFAULT_CONFIG: LoggerConfig = {
  level: __DEV__ ? 'debug' : 'info',
  enableConsole: true,
  enableStorage: true,
  maxStorageEntries: 500,
};

// ─── Log Level Priority ───────────────────────────────────────────────────────

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const STORAGE_KEY = '@petchain_logs';

// ─── Logger Service ───────────────────────────────────────────────────────────

class LoggerService {
  private config: LoggerConfig;
  private logBuffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;
  private storageInitialized = false;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeStorage();
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
    // Check if this log level should be processed
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

    // Add to buffer
    this.addToBuffer(logEntry);

    // Output to console if enabled
    if (this.config.enableConsole) {
      this.logToConsole(logEntry);
    }

    // Store to AsyncStorage if enabled
    if (this.config.enableStorage && this.storageInitialized) {
      this.logToStorage(logEntry).catch((err) => {
        console.warn('Failed to store log entry:', err);
      });
    }
  }

  // ─── Console Output ───────────────────────────────────────────────────────────

  private logToConsole(entry: LogEntry): void {
    const { level, message, timestamp, context, error } = entry;

    // Format the log message
    const formattedMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

    // Choose appropriate console method
    const consoleMethod = this.getConsoleMethod(level);

    if (context || error) {
      const additionalData: any = {};
      if (context) additionalData.context = context;
      if (error) additionalData.error = { message: error.message, stack: error.stack };

      consoleMethod(formattedMessage, additionalData);
    } else {
      consoleMethod(formattedMessage);
    }
  }

  private getConsoleMethod(level: LogLevel): (...args: any[]) => void {
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

  // ─── Storage Management ───────────────────────────────────────────────────────

  private async initializeStorage(): Promise<void> {
    try {
      // Load existing logs from storage
      const storedLogs = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedLogs) {
        const parsedLogs = JSON.parse(storedLogs) as LogEntry[];
        this.logBuffer = parsedLogs.slice(-this.maxBufferSize);
      }
      this.storageInitialized = true;
    } catch (error) {
      console.warn('Failed to initialize log storage:', error);
      this.storageInitialized = false;
    }
  }

  private async logToStorage(entry: LogEntry): Promise<void> {
    try {
      // Get current logs from storage
      const storedLogs = await AsyncStorage.getItem(STORAGE_KEY);
      let logs: LogEntry[] = storedLogs ? JSON.parse(storedLogs) : [];

      // Add new entry
      logs.push(entry);

      // Trim to max entries
      if (logs.length > this.config.maxStorageEntries) {
        logs = logs.slice(-this.config.maxStorageEntries);
      }

      // Save back to storage
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch (error) {
      // Don't log this error to avoid infinite recursion
      console.warn('Failed to store log entry:', error);
    }
  }

  // ─── Buffer Management ────────────────────────────────────────────────────────

  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);

    // Trim buffer if it exceeds max size
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
    }
  }

  // ─── Public Utility Methods ───────────────────────────────────────────────────

  /**
   * Get recent log entries from buffer
   */
  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logBuffer.slice(-count);
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogLevel, count: number = 100): LogEntry[] {
    return this.logBuffer.filter((entry) => entry.level === level).slice(-count);
  }

  /**
   * Get logs from storage
   */
  async getStoredLogs(count: number = 100): Promise<LogEntry[]> {
    try {
      const storedLogs = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedLogs) {
        const parsedLogs = JSON.parse(storedLogs) as LogEntry[];
        return parsedLogs.slice(-count);
      }
      return [];
    } catch (error) {
      console.warn('Failed to retrieve stored logs:', error);
      return [];
    }
  }

  /**
   * Clear the log buffer
   */
  clearBuffer(): void {
    this.logBuffer = [];
  }

  /**
   * Clear stored logs
   */
  async clearStoredLogs(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      this.logBuffer = [];
    } catch (error) {
      console.warn('Failed to clear stored logs:', error);
    }
  }

  /**
   * Export logs as JSON string
   */
  async exportLogs(): Promise<string> {
    try {
      const storedLogs = await AsyncStorage.getItem(STORAGE_KEY);
      return storedLogs || '[]';
    } catch (error) {
      console.warn('Failed to export logs:', error);
      return JSON.stringify(this.logBuffer);
    }
  }

  /**
   * Update logger configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Create a child logger with additional context
   */
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
