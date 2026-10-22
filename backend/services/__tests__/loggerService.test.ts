import logger from '../loggerService';

describe('backend loggerService', () => {
  const originalConsole = { ...console };
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch as any;
    console.debug = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    jest.clearAllMocks();
    // Reset logger to default state if possible, or configure it
    logger.configure({ isDevelopment: true, enableRemote: false });
  });

  afterAll(() => {
    global.console = originalConsole;
  });

  it('should log debug messages in development', () => {
    logger.debug('test message', { foo: 'bar' });
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('[DEBUG] test message | {"foo":"bar"}'),
    );
  });

  it('should not log debug messages in production', () => {
    logger.configure({ isDevelopment: false });
    logger.debug('test message');
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('should log info, warn, and error messages in both environments', () => {
    logger.configure({ isDevelopment: false });

    logger.info('info');
    expect(console.info).toHaveBeenCalled();

    logger.warn('warn');
    expect(console.warn).toHaveBeenCalled();

    logger.error('error');
    expect(console.error).toHaveBeenCalled();
  });

  it('should send logs to remote if enabled', async () => {
    const remoteUrl = 'https://logs.example.com';
    logger.configure({ enableRemote: true, remoteUrl });
    mockFetch.mockResolvedValue({ ok: true });

    logger.info('remote test');

    expect(mockFetch).toHaveBeenCalledWith(
      remoteUrl,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('remote test'),
      }),
    );
  });

  it('should handle remote log failure gracefully', async () => {
    logger.configure({ enableRemote: true, remoteUrl: 'http://fail' });
    mockFetch.mockRejectedValue(new Error('Network fail'));

    // Should not throw
    logger.error('test error');
    expect(console.error).toHaveBeenCalled();
  });
});
