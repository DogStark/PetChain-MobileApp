import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native';

import {
  buildDismissalAnnouncement,
  evaluateServerPermissionForFocus,
  FocusRecoveryRegistry,
  focusRecoveryRegistry,
  restoreFocusToInitiator,
  sanitizeFocusAnnouncement,
  type FocusRecoveryOutcome,
} from '../focusRecovery';

jest.mock('react-native', () => ({
  AccessibilityInfo: {
    setAccessibilityFocus: jest.fn(),
    announceForAccessibility: jest.fn(),
  },
  findNodeHandle: jest.fn(() => 101),
  Platform: {
    OS: 'ios',
  },
}));

const mockSetFocus = AccessibilityInfo.setAccessibilityFocus as jest.Mock;
const mockAnnounce = AccessibilityInfo.announceForAccessibility as jest.Mock;
const mockFindNode = findNodeHandle as jest.Mock;

describe('focusRecovery (issue #1198)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockFindNode.mockReturnValue(101);
    (Platform as { OS: string }).OS = 'ios';
    focusRecoveryRegistry.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('sanitizeFocusAnnouncement (privacy by default)', () => {
    it('redacts Stellar addresses, microchips, emails, phones, and secret tokens', () => {
      const stellarKey = 'G' + 'A'.repeat(55);
      const raw = `Closed prompt for microchip 985112003456789 owner jane.doe@example.com phone +1 (555) 234-5678 wallet ${stellarKey} medicalRecordId=rec_998877`;
      const sanitized = sanitizeFocusAnnouncement(raw);

      expect(sanitized).not.toContain('985112003456789');
      expect(sanitized).not.toContain('jane.doe@example.com');
      expect(sanitized).not.toContain('234-5678');
      expect(sanitized).not.toContain(stellarKey);
      expect(sanitized).not.toContain('rec_998877');
      expect(sanitized).toContain('[redacted-microchip]');
      expect(sanitized).toContain('[redacted-email]');
      expect(sanitized).toContain('[redacted-phone]');
      expect(sanitized).toContain('[redacted-address]');
      expect(sanitized).toContain('[redacted]');
    });

    it('returns empty string for null or undefined input', () => {
      expect(sanitizeFocusAnnouncement(null)).toBe('');
      expect(sanitizeFocusAnnouncement(undefined)).toBe('');
      expect(sanitizeFocusAnnouncement('   ')).toBe('');
    });
  });

  describe('evaluateServerPermissionForFocus (server-confirmed & offline continuity)', () => {
    const now = 1_700_000_000_000;

    it('allows fresh server-confirmed permission grant', () => {
      const res = evaluateServerPermissionForFocus(
        {
          permission: 'camera',
          serverConfirmed: true,
          granted: true,
          confirmedAt: now - 30_000,
        },
        now,
      );
      expect(res.allowed).toBe(true);
      expect(res.status).toBe('confirmed_grant');
    });

    it('flags denied state when serverConfirmed is false or granted is false', () => {
      const denied = evaluateServerPermissionForFocus(
        {
          permission: 'camera',
          serverConfirmed: true,
          granted: false,
          confirmedAt: now - 10_000,
        },
        now,
      );
      expect(denied.allowed).toBe(false);
      expect(denied.status).toBe('denied');

      const unconfirmed = evaluateServerPermissionForFocus(
        {
          permission: 'location',
          serverConfirmed: false,
          granted: true,
          confirmedAt: now - 10_000,
        },
        now,
      );
      expect(unconfirmed.allowed).toBe(false);
      expect(unconfirmed.status).toBe('denied');
    });

    it('flags stale state when server confirmation exceeds staleAfterMs', () => {
      const stale = evaluateServerPermissionForFocus(
        {
          permission: 'notifications',
          serverConfirmed: true,
          granted: true,
          confirmedAt: now - 10 * 60 * 1000,
          staleAfterMs: 5 * 60 * 1000,
        },
        now,
      );
      expect(stale.allowed).toBe(false);
      expect(stale.status).toBe('stale');
      expect(stale.reasonMessage).toContain('stale');
    });

    it('preserves existing offline behavior when offline with a cached grant', () => {
      const offlineAllowed = evaluateServerPermissionForFocus(
        {
          permission: 'camera',
          serverConfirmed: false,
          granted: false,
          confirmedAt: null,
          isOffline: true,
          offlineCachedGrant: true,
        },
        now,
      );
      expect(offlineAllowed.allowed).toBe(true);
      expect(offlineAllowed.status).toBe('offline_cached_grant');

      const offlineDenied = evaluateServerPermissionForFocus(
        {
          permission: 'camera',
          serverConfirmed: false,
          granted: false,
          confirmedAt: null,
          isOffline: true,
          offlineCachedGrant: false,
        },
        now,
      );
      expect(offlineDenied.allowed).toBe(false);
      expect(offlineDenied.status).toBe('denied');
    });
  });

  describe('restoreFocusToInitiator (main flow, retry, fallback, and platform support)', () => {
    it('restores accessibility focus to the initiating control after dialog dismissal', () => {
      const triggerRef = { current: { id: 'open-dialog-btn' } };
      let outcome: FocusRecoveryOutcome | undefined;

      restoreFocusToInitiator(triggerRef, undefined, {
        surfaceType: 'dialog',
        reason: 'confirm',
        onRecovered: (res) => {
          outcome = res;
        },
      });

      jest.advanceTimersByTime(60);

      expect(mockFindNode).toHaveBeenCalledWith(triggerRef.current);
      expect(mockSetFocus).toHaveBeenCalledWith(101);
      expect(outcome).toMatchObject({
        restored: true,
        usedFallback: false,
        nodeHandle: 101,
        attempts: 1,
        surfaceType: 'dialog',
        reason: 'confirm',
      });
    });

    it('retries focus restoration when node handle is unavailable on the first frame', () => {
      const triggerRef = { current: { id: 'picker-btn' } };
      mockFindNode.mockReturnValueOnce(null).mockReturnValueOnce(202);

      let outcome: FocusRecoveryOutcome | undefined;
      restoreFocusToInitiator(triggerRef, undefined, {
        surfaceType: 'picker',
        reason: 'cancel',
        maxRetries: 2,
        retryDelayMs: 40,
        onRecovered: (res) => {
          outcome = res;
        },
      });

      jest.advanceTimersByTime(45);
      expect(mockSetFocus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(45);
      expect(mockSetFocus).toHaveBeenCalledWith(202);
      expect(outcome?.restored).toBe(true);
      expect(outcome?.attempts).toBe(2);
    });

    it('falls back to fallbackRef when primary initiating control is disabled or unmounted', () => {
      const disabledTriggerRef = { current: { disabled: true } };
      const fallbackRef = { current: { id: 'fallback-btn' } };
      mockFindNode.mockReturnValue(303);

      let outcome: FocusRecoveryOutcome | undefined;
      restoreFocusToInitiator(disabledTriggerRef, fallbackRef, {
        surfaceType: 'permission_prompt',
        reason: 'permission_denied',
        onRecovered: (res) => {
          outcome = res;
        },
      });

      jest.advanceTimersByTime(60);

      expect(mockSetFocus).toHaveBeenCalledWith(303);
      expect(outcome?.restored).toBe(true);
      expect(outcome?.usedFallback).toBe(true);
      expect(mockAnnounce).toHaveBeenCalledWith(
        'Permission denied. Focus returned to the initiating control.',
      );
    });

    it('uses imperative .focus() on web or when nodeHandle is null', () => {
      (Platform as { OS: string }).OS = 'web';
      mockFindNode.mockReturnValue(null);
      const focusFn = jest.fn();
      const triggerRef = { current: { focus: focusFn } };

      let outcome: FocusRecoveryOutcome | undefined;
      restoreFocusToInitiator(triggerRef, undefined, {
        surfaceType: 'dialog',
        reason: 'backdrop',
        onRecovered: (res) => {
          outcome = res;
        },
      });

      jest.advanceTimersByTime(60);

      expect(focusFn).toHaveBeenCalledTimes(1);
      expect(outcome?.restored).toBe(true);
      expect(outcome?.usedImperativeFocus).toBe(true);
    });

    it('announces stale-data recovery and redacts sensitive tokens when permission confirmation is stale', () => {
      const now = 1_700_000_000_000;
      const triggerRef = { current: { id: 'retry-btn' } };

      let outcome: FocusRecoveryOutcome | undefined;
      restoreFocusToInitiator(triggerRef, undefined, {
        surfaceType: 'permission_prompt',
        reason: 'confirm',
        now,
        permissionState: {
          permission: 'camera',
          serverConfirmed: true,
          granted: true,
          confirmedAt: now - 600_000,
          staleAfterMs: 60_000,
        },
        onRecovered: (res) => {
          outcome = res;
        },
      });

      jest.advanceTimersByTime(60);

      expect(outcome?.reason).toBe('stale_data');
      expect(outcome?.permissionStatus).toBe('stale');
      expect(mockAnnounce).toHaveBeenCalledWith(
        'Permission confirmation is stale. Refresh or retry from the initiating control.',
      );
    });

    it('cancels pending focus timer when cleanup function is invoked', () => {
      const triggerRef = { current: { id: 'btn' } };
      const cancel = restoreFocusToInitiator(triggerRef, undefined, {
        retryDelayMs: 50,
      });

      cancel();
      jest.advanceTimersByTime(200);
      expect(mockSetFocus).not.toHaveBeenCalled();
    });
  });

  describe('FocusRecoveryRegistry & buildDismissalAnnouncement', () => {
    it('tracks nested dialogs, pickers, and permission prompts in LIFO order', () => {
      const registry = new FocusRecoveryRegistry();
      const dialogRef = { current: { id: 'dialog-trigger' } };
      const pickerRef = { current: { id: 'picker-trigger' } };

      registry.register({
        id: 'dialog-1',
        surfaceType: 'dialog',
        triggerRef: dialogRef,
        label: 'Edit pet microchip 985112003456789',
      });
      registry.register({
        id: 'picker-1',
        surfaceType: 'picker',
        triggerRef: pickerRef,
      });

      expect(registry.depth()).toBe(2);
      expect(registry.isTop('picker-1')).toBe(true);

      const { dismissed, remainingTop } = registry.dismiss('picker-1');
      expect(dismissed?.id).toBe('picker-1');
      expect(remainingTop?.id).toBe('dialog-1');
      expect(remainingTop?.label).toContain('[redacted-microchip]');
    });

    it('formats error announcements per surface type', () => {
      expect(
        buildDismissalAnnouncement({ surfaceType: 'picker', reason: 'error' }),
      ).toBe('Picker closed due to an error. Focus restored.');
      expect(
        buildDismissalAnnouncement({ surfaceType: 'permission_prompt', reason: 'error' }),
      ).toBe('Permission prompt closed due to an error. Focus restored.');
    });
  });
});
