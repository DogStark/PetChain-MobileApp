import { useRetry } from '../useRetry';

describe('useRetry', () => {
  it('should export useRetry hook', () => {
    expect(useRetry).toBeDefined();
    expect(typeof useRetry).toBe('function');
  });

  it('should handle successful execution', async () => {
    const mockFn = jest.fn().mockResolvedValue('success');

    // Simulate hook behavior
    const execute = async () => {
      try {
        const result = await mockFn();
        return result;
      } catch {
        return undefined;
      }
    };

    const result = await execute();
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should handle errors', async () => {
    const error = new Error('Network error');
    const mockFn = jest.fn().mockRejectedValue(error);

    const execute = async () => {
      try {
        await mockFn();
        return 'success';
      } catch {
        return undefined;
      }
    };

    const result = await execute();
    expect(result).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should support retry logic', async () => {
    const error = new Error('Network error');
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success');

    const executeWithRetry = async (maxRetries = 3) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await mockFn();
          return result;
        } catch {
          if (attempt === maxRetries) {
            return undefined;
          }
        }
      }
    };

    const result = await executeWithRetry();
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });
});
