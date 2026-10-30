/**
 * Biometric re-authentication before sensitive exports tests — Issue #1193
 */

jest.mock('../api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../utils/networkMonitor', () => ({ networkMonitor: { isOnline: jest.fn() } }));
jest.mock('../biometricService', () => ({ authenticateWithBiometrics: jest.fn() }));

import api from '../api';
import { authenticateWithBiometrics } from '../biometricService';
import { networkMonitor } from '../../utils/networkMonitor';
import { requireExportReauth } from '../sensitiveExportGate';

const mockApi = api as unknown as { get: jest.Mock };
const online = networkMonitor.isOnline as jest.Mock;
const bio = authenticateWithBiometrics as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  online.mockResolvedValue(true);
  mockApi.get.mockResolvedValue({ data: { canExport: true } });
});

describe('requireExportReauth', () => {
  it('allows export after server permission and biometric success', async () => {
    bio.mockResolvedValue({ success: true });
    await expect(requireExportReauth('p1')).resolves.toEqual({
      allowed: true,
      biometricVerified: true,
    });
  });

  it('denies without prompting when the server refuses or the device is offline', async () => {
    mockApi.get.mockResolvedValue({ data: { canExport: false } });
    expect(await requireExportReauth('p1')).toMatchObject({
      allowed: false,
      reason: 'not_permitted',
    });
    mockApi.get.mockRejectedValue({ response: { status: 403 } });
    expect(await requireExportReauth('p1')).toMatchObject({ reason: 'not_permitted' });
    mockApi.get.mockRejectedValue(new Error('boom'));
    expect(await requireExportReauth('p1')).toMatchObject({ reason: 'error' });
    online.mockResolvedValue(false);
    expect(await requireExportReauth('p1')).toMatchObject({ reason: 'offline' });
    expect(bio).not.toHaveBeenCalled();
  });

  it('handles cancel and lockout', async () => {
    bio.mockResolvedValue({ success: false, fallbackReason: 'user_cancelled' });
    expect(await requireExportReauth('p1')).toMatchObject({ reason: 'cancelled' });
    bio.mockResolvedValue({ success: false, fallbackReason: 'lockout' });
    expect(await requireExportReauth('p1')).toMatchObject({ reason: 'lockout' });
  });

  it('applies the fallback policy when hardware is unavailable', async () => {
    bio.mockResolvedValue({ success: false, fallbackReason: 'unavailable' });
    expect(await requireExportReauth('p1')).toMatchObject({
      allowed: false,
      reason: 'unavailable',
    });
    bio.mockResolvedValue({ success: false, fallbackReason: 'not_enrolled' });
    expect(await requireExportReauth('p1', 'allow_device_unprotected')).toEqual({
      allowed: true,
      biometricVerified: false,
    });
  });
});
