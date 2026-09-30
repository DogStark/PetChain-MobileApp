import { withRetry } from '../retry';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on network error then succeeds', async () => {
    const networkError = new Error('Network Error') as any;
    networkError.request = true;
    const fn = jest.fn().mockRejectedValueOnce(networkError).mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 2, initialDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 then succeeds', async () => {
    const serverError = new Error('Server Error') as any;
    serverError.response = { status: 500 };
    const fn = jest.fn().mockRejectedValueOnce(serverError).mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 2, initialDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 400', async () => {
    const clientError = new Error('Bad Request') as any;
    clientError.response = { status: 400 };
    const fn = jest.fn().mockRejectedValue(clientError);
    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 404', async () => {
    const clientError = new Error('Not Found') as any;
    clientError.response = { status: 404 };
    const fn = jest.fn().mockRejectedValue(clientError);
    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries on network error', async () => {
    const networkError = new Error('Network Error') as any;
    networkError.request = true;
    const fn = jest.fn().mockRejectedValue(networkError);
    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow(
      'Network Error',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff', async () => {
    const networkError = new Error('Network Error') as any;
    networkError.request = true;
    const fn = jest.fn().mockRejectedValue(networkError);

    const start = Date.now();
    await expect(
      withRetry(fn, { maxRetries: 2, initialDelay: 100, backoffMultiplier: 2 }),
    ).rejects.toThrow();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
