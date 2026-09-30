import {
  parseApiError,
  getErrorMessage,
  isNetworkError,
  isAuthError,
} from '../errorUtils';

// ─── parseApiError ───────────────────────────────────────────────────────────

describe('parseApiError', () => {
  describe('with null/undefined input', () => {
    it('should return fallback message for null', () => {
      const result = parseApiError(null);
      expect(result).toEqual({ message: 'An unknown error occurred.' });
    });

    it('should return fallback message for undefined', () => {
      const result = parseApiError(undefined);
      expect(result).toEqual({ message: 'An unknown error occurred.' });
    });
  });

  describe('with Axios-like errors', () => {
    it('should parse Axios error with response data', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Validation failed', code: 'VALIDATION_ERROR' },
        },
        config: {},
      };
      const result = parseApiError(error);
      expect(result).toEqual({
        status: 400,
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
      });
    });

    it('should parse Axios error without response data', () => {
      const error = {
        response: {
          status: 500,
          statusText: 'Internal Server Error',
        },
        config: {},
      };
      const result = parseApiError(error);
      expect(result).toEqual({
        status: 500,
        message: 'Internal Server Error',
        code: undefined,
      });
    });

    it('should parse Axios network error (no response)', () => {
      const error = {
        code: 'ERR_NETWORK',
        message: 'Network Error',
        config: {},
      };
      const result = parseApiError(error);
      expect(result.message).toBe('Network Error');
      expect(result.code).toBe('ERR_NETWORK');
    });
  });

  describe('with Fetch-like errors', () => {
    it('should parse Fetch error with status and statusText', () => {
      const error = { status: 404, statusText: 'Not Found' };
      const result = parseApiError(error);
      expect(result).toEqual({
        status: 404,
        message: 'Not Found',
      });
    });

    it('should parse Fetch error with message', () => {
      const error = { status: 503, message: 'Service Unavailable' };
      const result = parseApiError(error);
      expect(result).toEqual({ status: 503, message: 'Service Unavailable' });
    });
  });

  describe('with Error instances', () => {
    it('should parse a standard Error', () => {
      const error = new Error('Something went wrong');
      const result = parseApiError(error);
      expect(result).toEqual({ message: 'Something went wrong' });
    });
  });

  describe('with string errors', () => {
    it('should treat a string as the error message', () => {
      const result = parseApiError('Custom error string');
      expect(result).toEqual({ message: 'Custom error string' });
    });
  });

  describe('with plain object errors', () => {
    it('should extract status, message, and code from an object', () => {
      const error = { status: 403, message: 'Forbidden', code: 'FORBIDDEN' };
      const result = parseApiError(error);
      expect(result).toEqual({ status: 403, message: 'Forbidden', code: 'FORBIDDEN' });
    });

    it('should handle object with partial fields', () => {
      const error = { code: 'RATE_LIMITED' };
      const result = parseApiError(error);
      expect(result).toEqual({ status: undefined, message: undefined, code: 'RATE_LIMITED' });
    });
  });

  describe('with unexpected types', () => {
    it('should convert number to string message', () => {
      const result = parseApiError(42);
      expect(result).toEqual({ message: '42' });
    });

    it('should convert boolean to string message', () => {
      const result = parseApiError(true);
      expect(result).toEqual({ message: 'true' });
    });
  });
});


// ─── getErrorMessage ─────────────────────────────────────────────────────────

describe('getErrorMessage', () => {
  it('should return extracted message for Axios error', () => {
    const error = {
      isAxiosError: true,
      response: { status: 400, data: { message: 'Bad Request' } },
      config: {},
    };
    expect(getErrorMessage(error)).toBe('Bad Request');
  });

  it('should return extracted message for Error instance', () => {
    expect(getErrorMessage(new Error('Disk full'))).toBe('Disk full');
  });

  it('should return extracted message for string', () => {
    expect(getErrorMessage('string error')).toBe('string error');
  });

  it('should return custom fallback when no message is available', () => {
    expect(getErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
  });

  it('should return default fallback when no message or fallback provided', () => {
    expect(getErrorMessage(null)).toBe('An unexpected error occurred.');
  });

  it('should return extracted message for plain object with message', () => {
    expect(getErrorMessage({ message: 'Object message' })).toBe('Object message');
  });

  it('should return fallback for object without message', () => {
    expect(getErrorMessage({ code: 'UNKNOWN' }, 'Fallback message')).toBe('Fallback message');
  });
});

// ─── isNetworkError ──────────────────────────────────────────────────────────

describe('isNetworkError', () => {
  it('should return true for Axios ERR_NETWORK code', () => {
    expect(isNetworkError({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(true);
  });

  it('should return true for "Network Error" message', () => {
    expect(isNetworkError({ message: 'Network Error' })).toBe(true);
  });

  it('should return true for ECONNABORTED', () => {
    expect(isNetworkError({ code: 'ECONNABORTED' })).toBe(true);
  });

  it('should return true for ECONNRESET', () => {
    expect(isNetworkError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('should return true for ETIMEDOUT', () => {
    expect(isNetworkError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('should return true for ENOTFOUND', () => {
    expect(isNetworkError({ code: 'ENOTFOUND' })).toBe(true);
  });

  it('should return true when request exists but no response', () => {
    expect(isNetworkError({ request: {}, response: undefined })).toBe(true);
  });

  it('should return false when request and response both exist', () => {
    expect(isNetworkError({ request: {}, response: { status: 200 } })).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });

  it('should return false for non-object types', () => {
    expect(isNetworkError('string')).toBe(false);
    expect(isNetworkError(42)).toBe(false);
  });

  it('should return false for a plain HTTP error', () => {
    expect(isNetworkError({ response: { status: 500 }, message: 'Server error' })).toBe(false);
  });

  it('should return false for auth errors', () => {
    expect(isNetworkError({ response: { status: 401 } })).toBe(false);
  });

  it('should return false for empty object', () => {
    expect(isNetworkError({})).toBe(false);
  });
});

// ─── isAuthError ─────────────────────────────────────────────────────────────

describe('isAuthError', () => {
  it('should return true for 401 status at top level', () => {
    expect(isAuthError({ status: 401 })).toBe(true);
  });

  it('should return true for 403 status at top level', () => {
    expect(isAuthError({ status: 403 })).toBe(true);
  });

  it('should return true for 401 in nested response', () => {
    expect(isAuthError({ response: { status: 401 } })).toBe(true);
  });

  it('should return true for 403 in nested response', () => {
    expect(isAuthError({ response: { status: 403 } })).toBe(true);
  });

  it('should return true for UNAUTHORIZED code', () => {
    expect(isAuthError({ code: 'UNAUTHORIZED' })).toBe(true);
  });

  it('should return true for FORBIDDEN code', () => {
    expect(isAuthError({ code: 'FORBIDDEN' })).toBe(true);
  });

  it('should return true for AUTH_ERROR code', () => {
    expect(isAuthError({ code: 'AUTH_ERROR' })).toBe(true);
  });

  it('should return false for non-auth status codes', () => {
    expect(isAuthError({ status: 500 })).toBe(false);
    expect(isAuthError({ status: 400 })).toBe(false);
    expect(isAuthError({ status: 404 })).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });

  it('should return false for non-object types', () => {
    expect(isAuthError('string')).toBe(false);
    expect(isAuthError(42)).toBe(false);
  });

  it('should return false for network errors', () => {
    expect(isAuthError({ code: 'ERR_NETWORK' })).toBe(false);
  });

  it('should return false for empty object', () => {
    expect(isAuthError({})).toBe(false);
  });
});

