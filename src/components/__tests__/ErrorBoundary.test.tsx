/**
 * Tests for ErrorBoundary component and PII scrubbing utility.
 *
 * Note: React Native component rendering tests require a React Native
 * test environment (e.g. @testing-library/react-native). These tests
 * cover the scrubPII utility and the class component logic directly,
 * which run in the standard Node/ts-jest environment configured in
 * package.json.
 */
import React from 'react';

import { scrubPII, ErrorBoundary } from '../ErrorBoundary';

// ---------------------------------------------------------------------------
// scrubPII unit tests
// ---------------------------------------------------------------------------
describe('scrubPII', () => {
  it('redacts email addresses', () => {
    expect(scrubPII('Contact user@example.com for help')).not.toContain('user@example.com');
    expect(scrubPII('Contact user@example.com for help')).toContain('[email]');
  });

  it('redacts phone numbers', () => {
    const result = scrubPII('Call +12025551234 now');
    expect(result).not.toContain('+12025551234');
    expect(result).toContain('[phone]');
  });

  it('redacts name/address fields', () => {
    const result = scrubPII('name: John Doe, city: Springfield');
    expect(result).not.toContain('John Doe');
  });

  it('leaves non-PII strings unchanged', () => {
    const safe = 'TypeError: Cannot read property of undefined';
    expect(scrubPII(safe)).toBe(safe);
  });

  it('handles empty string', () => {
    expect(scrubPII('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ErrorBoundary class logic tests (no RN renderer needed)
// ---------------------------------------------------------------------------
describe('ErrorBoundary.getDerivedStateFromError', () => {
  it('sets hasError to true with the caught error', () => {
    const error = new Error('boom');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });
});

describe('ErrorBoundary.handleRetry', () => {
  it('resets error state when retry is called', () => {
    // Instantiate with minimal props to test the method directly
    const boundary = new ErrorBoundary({
      children: React.createElement('div'),
      context: { screenName: 'TestScreen' },
    });
    // Simulate crashed state
    boundary.state = { hasError: true, error: new Error('test') };

    // Mock setState
    const calls: object[] = [];
    boundary.setState = (s: object) => {
      calls.push(s);
    };

    boundary.handleRetry();
    expect(calls[0]).toEqual({ hasError: false, error: null });
  });
});
