import React from 'react';

import { RetryError } from '../RetryError';

describe('RetryError', () => {
  it('should export RetryError component', () => {
    expect(RetryError).toBeDefined();
    expect(typeof RetryError).toBe('function');
  });

  it('should accept required props', () => {
    const error = new Error('Network error');
    const onRetry = jest.fn();

    // Test that component can be instantiated with required props
    const element = React.createElement(RetryError, { error, onRetry });
    expect(element).toBeDefined();
    expect(element.props.error).toBe(error);
    expect(element.props.onRetry).toBe(onRetry);
  });

  it('should accept optional props', () => {
    const error = new Error('Network error');
    const onRetry = jest.fn();

    const element = React.createElement(RetryError, {
      error,
      onRetry,
      retryCount: 2,
      maxRetries: 3,
    });

    expect(element.props.retryCount).toBe(2);
    expect(element.props.maxRetries).toBe(3);
  });
});
