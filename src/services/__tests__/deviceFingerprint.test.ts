/**
 * Unit tests for src/services/deviceFingerprint.ts
 */

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    app: { version: '1.2.3' },
  },
}));

import { getDefaultDevice, type DeviceMetadata } from '../deviceFingerprint';

describe('getDefaultDevice()', () => {
  it('returns a DeviceMetadata object with unknown fields and the configured appVersion', () => {
    const device: DeviceMetadata = getDefaultDevice();
    expect(device.model).toBe('unknown');
    expect(device.os).toBe('unknown');
    expect(device.osVersion).toBe('unknown');
    expect(device.platform).toBe('unknown');
    expect(device.appVersion).toBe('1.2.3');
  });
});
