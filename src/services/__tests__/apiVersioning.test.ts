import config from '../../config';
import apiClient from '../apiClient';

describe('API Versioning Header', () => {
  it('should include X-API-Version header in the default axios instance', () => {
    const headers = apiClient.defaults.headers as any;
    expect(headers['X-API-Version']).toBe(config.api.version);
    expect(headers['X-API-Version']).toBe('1.0');
  });

  it('should default to version 1.0 in config', () => {
    expect(config.api.version).toBe('1.0');
  });
});
