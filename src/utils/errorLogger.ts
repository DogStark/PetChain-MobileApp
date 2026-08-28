import crashReporting from '../services/crashReporting';

declare const __DEV__: boolean;

type ErrorContext = {
  service?: string;
  screen?: string;
  action?: string;
  userId?: string;
  status?: number;
  [key: string]: unknown;
};

type LoggedError = {
  message: string;
  stack?: string;
  context?: ErrorContext;
  timestamp: number;
};

const errorFrequency = new Map<string, number>();

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export function logError(error: Error, context?: ErrorContext): void {
  const key = error.message;

  // Track frequency
  const count = errorFrequency.get(key) || 0;
  const newCount = count + 1;
  errorFrequency.set(key, newCount);

  const log: LoggedError = {
    message: error.message,
    stack: error.stack,
    context,
    timestamp: Date.now(),
  };

  // Dev logging
  if (isDev) {
    console.error('🚨 Error Logged:', log);
  }

  // Send to external service (mock for now)
  sendToService(log, newCount);
}

function sendToService(log: LoggedError, frequency: number): void {
  crashReporting.captureException(Object.assign(new Error(log.message), { stack: log.stack }), {
    ...(log.context ?? {}),
    frequency,
  });
}
