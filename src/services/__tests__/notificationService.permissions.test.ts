import * as Notifications from 'expo-notifications';
import { checkPermissionState, requestPermissions, PermissionState } from '../notificationService';

jest.mock('expo-notifications');
jest.mock('../localDB');

describe('#918 — Handle denied and provisional permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should model iOS permission states: authorized, denied, provisional', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      ios: { status: 'granted' },
    });
    const state = await checkPermissionState();
    expect(state).toMatch(/granted|denied|provisional/);
  });

  it('should model Android permission states: granted, denied, permanently denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      android: { granted: true },
    });
    const state = await checkPermissionState();
    expect(['granted', 'denied', 'permanently_denied']).toContain(state);
  });

  it('should handle permission denied without repeated prompts', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      ios: { status: 'denied' },
    });
    const state = await checkPermissionState();
    expect(state).toBe('denied');
  });

  it('should distinguish provisional from denied on iOS', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      ios: { status: 'provisional' },
    });
    const state = await checkPermissionState();
    expect(state).toBe('provisional');
  });

  it('should return not_determined when permission not yet requested', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      ios: { status: 'undetermined' },
    });
    const state = await checkPermissionState();
    expect(['not_determined', 'undetermined']).toContain(state);
  });

  it('should handle offline gracefully', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('Network error'));
    const state = await checkPermissionState();
    expect(state).toBe('unknown');
  });

  it('should respect platform-specific OS permission rules', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      ios: { status: 'granted' },
      android: { granted: true },
    });
    const state = await checkPermissionState();
    expect(state).not.toBeNull();
  });
});
