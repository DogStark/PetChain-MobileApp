/**
 * Tests for src/services/errorTracking.ts
 *
 * Verifies: initialisation, error/message capture, user context,
 * breadcrumbs, and performance transaction lifecycle.
 */

import * as Sentry from '@sentry/react-native';

// The mock is auto-resolved from src/__mocks__/@sentry/react-native.ts
// via the moduleNameMapper pattern in jest config (manual mock directory).
// We import the mock helpers for assertions.
const { mockTransaction, mockScope } = Sentry as unknown as {
  mockTransaction: { setStatus: jest.Mock; finish: jest.Mock };
  mockScope: { setExtras: jest.Mock; setSpan: jest.Mock };
};

// Import after mocks are set up
import errorTracking, {
  init,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  breadcrumbNavigation,
  breadcrumbApiRequest,
  breadcrumbApiResponse,
  breadcrumbBlockchain,
  breadcrumbAuth,
  breadcrumbSync,
  breadcrumbSOS,
  startTransaction,
} from '../services/errorTracking';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Initialisation ──────────────────────────────────────────────────────────

describe('init', () => {
  it('does not throw when DSN is empty (default mock)', () => {
    // expo-constants mock returns SENTRY_DSN: '' by default
    // init() should silently skip without throwing
    expect(() => init()).not.toThrow();
  });

  it('does not call Sentry.init when DSN is empty', () => {
    init();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('is exposed on the default export', () => {
    expect(typeof errorTracking.init).toBe('function');
  });
});

// ─── captureException ────────────────────────────────────────────────────────

describe('captureException', () => {
  it('calls Sentry.captureException for Error instances', () => {
    const err = new Error('test error');
    captureException(err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('calls Sentry.captureMessage for non-Error values', () => {
    captureException('string error');
    expect(Sentry.captureMessage).toHaveBeenCalledWith('string error', 'error');
  });

  it('uses withScope when context is provided', () => {
    const err = new Error('ctx error');
    captureException(err, { foo: 'bar' });
    expect(Sentry.withScope).toHaveBeenCalled();
    expect(mockScope.setExtras).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('sanitizes PII keys in context', () => {
    const err = new Error('pii error');
    captureException(err, { email: 'user@example.com', foo: 'bar' });
    expect(mockScope.setExtras).toHaveBeenCalledWith({ email: '[redacted]', foo: 'bar' });
  });
});

// ─── captureMessage ──────────────────────────────────────────────────────────

describe('captureMessage', () => {
  it('calls Sentry.captureMessage with default level', () => {
    captureMessage('hello');
    expect(Sentry.captureMessage).toHaveBeenCalledWith('hello', 'info');
  });

  it('passes custom level', () => {
    captureMessage('warn msg', 'warning');
    expect(Sentry.captureMessage).toHaveBeenCalledWith('warn msg', 'warning');
  });

  it('uses withScope when context is provided', () => {
    captureMessage('ctx msg', 'info', { key: 'value' });
    expect(Sentry.withScope).toHaveBeenCalled();
  });
});

// ─── User context ─────────────────────────────────────────────────────────────

describe('setUser', () => {
  it('calls Sentry.setUser with id', () => {
    setUser({ id: 'user-123' });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-123' });
  });

  it('includes email when provided', () => {
    setUser({ id: 'user-123', email: 'a@b.com' });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-123', email: 'a@b.com' });
  });

  it('sets app_user context with petCount and subscriptionTier', () => {
    setUser({ id: 'u1', petCount: 3, subscriptionTier: 'premium' });
    expect(Sentry.setContext).toHaveBeenCalledWith('app_user', {
      petCount: 3,
      subscriptionTier: 'premium',
    });
  });
});

describe('clearUser', () => {
  it('clears Sentry user and context', () => {
    clearUser();
    expect(Sentry.setUser).toHaveBeenCalledWith(null);
    expect(Sentry.setContext).toHaveBeenCalledWith('app_user', null);
  });
});

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────

describe('breadcrumbNavigation', () => {
  it('adds a navigation breadcrumb', () => {
    breadcrumbNavigation('HomeScreen');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'navigation', message: 'Navigated to HomeScreen' }),
    );
  });
});

describe('breadcrumbApiRequest', () => {
  it('adds an api.request breadcrumb', () => {
    breadcrumbApiRequest('get', '/api/pets');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'api.request', message: 'GET /api/pets' }),
    );
  });
});

describe('breadcrumbApiResponse', () => {
  it('adds an api.response breadcrumb with info level for 2xx', () => {
    breadcrumbApiResponse('get', '/api/pets', 200, 120);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'api.response',
        message: 'GET /api/pets → 200',
        level: 'info',
        data: { durationMs: 120 },
      }),
    );
  });

  it('uses warning level for 4xx responses', () => {
    breadcrumbApiResponse('post', '/api/login', 401);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });
});

describe('breadcrumbBlockchain', () => {
  it('adds a blockchain breadcrumb for submit', () => {
    breadcrumbBlockchain('submit', 'abc123');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'blockchain', message: 'Transaction submit: abc123' }),
    );
  });

  it('uses error level for failed transactions', () => {
    breadcrumbBlockchain('failed');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});

describe('breadcrumbAuth', () => {
  it('adds auth breadcrumb for login', () => {
    breadcrumbAuth('login');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'auth', message: 'login', level: 'info' }),
    );
  });

  it('uses warning level for login_failed', () => {
    breadcrumbAuth('login_failed');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });
});

describe('breadcrumbSync', () => {
  it('adds sync breadcrumb with record count', () => {
    breadcrumbSync('complete', 5);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        message: 'Sync complete',
        data: { recordCount: 5 },
      }),
    );
  });

  it('uses error level for failed sync', () => {
    breadcrumbSync('failed');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});

describe('breadcrumbSOS', () => {
  it('adds SOS breadcrumb', () => {
    breadcrumbSOS('triggered');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'sos', message: 'SOS triggered' }),
    );
  });
});

// ─── Performance tracing ─────────────────────────────────────────────────────

describe('startTransaction', () => {
  it('starts a Sentry transaction', () => {
    startTransaction('login');
    expect(Sentry.startTransaction).toHaveBeenCalledWith({ name: 'login', op: 'login' });
  });

  it('uses custom name when provided', () => {
    startTransaction('sync', 'Record Sync');
    expect(Sentry.startTransaction).toHaveBeenCalledWith({ name: 'Record Sync', op: 'sync' });
  });

  it('finishes the transaction with ok status by default', () => {
    const finish = startTransaction('sos');
    finish();
    expect(mockTransaction.setStatus).toHaveBeenCalledWith('ok');
    expect(mockTransaction.finish).toHaveBeenCalled();
  });

  it('finishes the transaction with provided status', () => {
    const finish = startTransaction('blockchain');
    finish('internal_error');
    expect(mockTransaction.setStatus).toHaveBeenCalledWith('internal_error');
  });
});
