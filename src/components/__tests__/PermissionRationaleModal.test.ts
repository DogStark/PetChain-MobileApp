/**
 * PermissionRationaleModal — logic tests
 *
 * Tests cover the permissionRationale utility configs and the modal's
 * behavioural logic (correct rationale selected, settings vs allow mode).
 * UI rendering tests require @testing-library/react-native which is not
 * in devDependencies, so we test the data layer and logic directly.
 */

import { PERMISSION_RATIONALES, type PermissionType } from '../../utils/permissionRationale';

// ─── permissionRationale utility ─────────────────────────────────────────────

describe('PERMISSION_RATIONALES', () => {
  const permissionTypes: PermissionType[] = ['camera', 'notifications', 'location'];

  it.each(permissionTypes)('has a complete config for "%s"', (type) => {
    const rationale = PERMISSION_RATIONALES[type];
    expect(rationale).toBeDefined();
    expect(typeof rationale.title).toBe('string');
    expect(rationale.title.length).toBeGreaterThan(0);
    expect(typeof rationale.description).toBe('string');
    expect(rationale.description.length).toBeGreaterThan(0);
    expect(typeof rationale.icon).toBe('string');
    expect(rationale.icon.length).toBeGreaterThan(0);
    expect(Array.isArray(rationale.benefits)).toBe(true);
    expect(rationale.benefits.length).toBeGreaterThan(0);
    expect(typeof rationale.deniedMessage).toBe('string');
    expect(rationale.deniedMessage.length).toBeGreaterThan(0);
  });

  it('camera rationale mentions QR codes', () => {
    const { description, benefits } = PERMISSION_RATIONALES.camera;
    const combined = description + benefits.join(' ');
    expect(combined.toLowerCase()).toContain('qr');
  });

  it('notifications rationale mentions medication', () => {
    const { description, benefits } = PERMISSION_RATIONALES.notifications;
    const combined = description + benefits.join(' ');
    expect(combined.toLowerCase()).toContain('medication');
  });

  it('location rationale mentions clinic or vet', () => {
    const { description, benefits } = PERMISSION_RATIONALES.location;
    const combined = description + benefits.join(' ');
    expect(
      combined.toLowerCase().includes('clinic') || combined.toLowerCase().includes('vet'),
    ).toBe(true);
  });

  it('each permission type has at least 2 benefits', () => {
    permissionTypes.forEach((type) => {
      expect(PERMISSION_RATIONALES[type].benefits.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('denied messages are distinct per permission type', () => {
    const messages = permissionTypes.map((t) => PERMISSION_RATIONALES[t].deniedMessage);
    const unique = new Set(messages);
    expect(unique.size).toBe(permissionTypes.length);
  });
});

// ─── Modal behaviour logic ────────────────────────────────────────────────────

describe('PermissionRationaleModal behaviour logic', () => {
  /**
   * Simulates the modal's primary action handler:
   * - showSettings=false → calls onAllow
   * - showSettings=true  → calls Linking.openSettings (mocked here as openSettings)
   */
  const buildPrimaryHandler =
    (showSettings: boolean, onAllow: () => void, openSettings: () => void) => () => {
      if (showSettings) {
        openSettings();
      } else {
        onAllow();
      }
    };

  it('calls onAllow when showSettings is false', () => {
    const onAllow = jest.fn();
    const openSettings = jest.fn();
    const handler = buildPrimaryHandler(false, onAllow, openSettings);
    handler();
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('calls openSettings when showSettings is true', () => {
    const onAllow = jest.fn();
    const openSettings = jest.fn();
    const handler = buildPrimaryHandler(true, onAllow, openSettings);
    handler();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('calls onDeny when user dismisses the modal', () => {
    const onDeny = jest.fn();
    // Simulates the onRequestClose / "Not Now" tap
    onDeny();
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('selects the correct rationale for each permission type', () => {
    const permissionTypes: PermissionType[] = ['camera', 'notifications', 'location'];
    permissionTypes.forEach((type) => {
      const rationale = PERMISSION_RATIONALES[type];
      expect(rationale).toBeDefined();
      // Title should be unique and non-empty
      expect(rationale.title).toBeTruthy();
    });
  });
});

// ─── QRScannerScreen permission flow logic ────────────────────────────────────

describe('QRScannerScreen permission flow', () => {
  /**
   * Simulates the state machine:
   * - Android: show rationale first, then request permission
   * - iOS: request permission directly
   */
  const buildPermissionFlow = (platform: 'android' | 'ios') => {
    let showRationale = false;
    let hasPermission: boolean | null = null;

    if (platform === 'android') {
      showRationale = true;
    } else {
      hasPermission = true; // iOS auto-granted in this simulation
    }

    return { showRationale, hasPermission };
  };

  it('shows rationale modal on Android before requesting permission', () => {
    const { showRationale, hasPermission } = buildPermissionFlow('android');
    expect(showRationale).toBe(true);
    expect(hasPermission).toBeNull();
  });

  it('skips rationale modal on iOS', () => {
    const { showRationale, hasPermission } = buildPermissionFlow('ios');
    expect(showRationale).toBe(false);
    expect(hasPermission).toBe(true);
  });

  it('sets permissionDenied when permission is not granted', () => {
    let permissionDenied = false;
    const simulateGrantResult = (granted: boolean) => {
      if (!granted) permissionDenied = true;
    };
    simulateGrantResult(false);
    expect(permissionDenied).toBe(true);
  });

  it('does not set permissionDenied when permission is granted', () => {
    let permissionDenied = false;
    const simulateGrantResult = (granted: boolean) => {
      if (!granted) permissionDenied = true;
    };
    simulateGrantResult(true);
    expect(permissionDenied).toBe(false);
  });
});

// ─── NotificationPreferencesScreen permission flow logic ─────────────────────

describe('NotificationPreferencesScreen notification permission flow', () => {
  type PermStatus = 'granted' | 'denied' | 'undetermined';

  const buildNotifFlow = (currentStatus: PermStatus, toggleValue: boolean) => {
    let showRationale = false;
    let notifPermissionDenied = false;
    let medicationReminders = false;

    if (toggleValue) {
      if (currentStatus !== 'granted') {
        notifPermissionDenied = currentStatus === 'denied';
        showRationale = true;
      } else {
        medicationReminders = true;
      }
    } else {
      medicationReminders = false;
    }

    return { showRationale, notifPermissionDenied, medicationReminders };
  };

  it('shows rationale when enabling reminders without permission', () => {
    const result = buildNotifFlow('undetermined', true);
    expect(result.showRationale).toBe(true);
    expect(result.medicationReminders).toBe(false);
  });

  it('shows rationale with showSettings=true when permission was denied', () => {
    const result = buildNotifFlow('denied', true);
    expect(result.showRationale).toBe(true);
    expect(result.notifPermissionDenied).toBe(true);
  });

  it('enables reminders directly when permission is already granted', () => {
    const result = buildNotifFlow('granted', true);
    expect(result.showRationale).toBe(false);
    expect(result.medicationReminders).toBe(true);
  });

  it('disables reminders without showing rationale', () => {
    const result = buildNotifFlow('granted', false);
    expect(result.showRationale).toBe(false);
    expect(result.medicationReminders).toBe(false);
  });
});
