import {
  CARE_ACTION_COMPLETE,
  CARE_ACTION_SNOOZE,
  CARE_REMINDER_CATEGORY_ID,
  DEFAULT_CARE_PRIVACY_MODE,
  DEFAULT_CARE_SNOOZE_MINUTES,
  MAX_CARE_SNOOZE_MINUTES,
  MIN_CARE_SNOOZE_MINUTES,
  buildCareReminderActionPayload,
  clampSnoozeMinutes,
  clearProcessedCareActions,
  executeCareReminderAction,
  getCareReminderCategoryActions,
  isCareReminderActionsSupported,
  registerCareReminderCategory,
  validateCareReminderActionPayload,
} from '../careReminderActions';

describe('careReminderActions (Issue #1189)', () => {
  const fixedNowMs = Date.parse('2026-10-20T12:00:00.000Z');
  const validIssuedAt = '2026-10-20T11:30:00.000Z';

  beforeEach(() => {
    clearProcessedCareActions();
  });

  describe('platform support and category registration', () => {
    it('exposes complete and snooze actions on iOS and Android when supported', async () => {
      const setNotificationCategoryAsync = jest.fn().mockResolvedValue(undefined);

      expect(isCareReminderActionsSupported('ios')).toBe(true);
      expect(isCareReminderActionsSupported('android')).toBe(true);

      const registration = await registerCareReminderCategory(
        { setNotificationCategoryAsync },
        { platformOs: 'ios', snoozeMinutes: 30 },
      );

      expect(registration.registered).toBe(true);
      expect(registration.categoryId).toBe(CARE_REMINDER_CATEGORY_ID);
      expect(registration.actions).toHaveLength(2);
      expect(registration.actions[0]).toMatchObject({
        identifier: CARE_ACTION_COMPLETE,
        buttonTitle: 'Complete',
        accessibilityLabel: 'Mark care reminder as complete',
      });
      expect(registration.actions[1]).toMatchObject({
        identifier: CARE_ACTION_SNOOZE,
        buttonTitle: 'Snooze 30 min',
        accessibilityLabel: 'Snooze care reminder for 30 minutes',
      });
      expect(setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    });

    it('gracefully skips registration on unsupported platforms or disabled capabilities', async () => {
      const setNotificationCategoryAsync = jest.fn();

      expect(isCareReminderActionsSupported('web')).toBe(false);
      expect(
        isCareReminderActionsSupported('ios', {
          supportsNotificationCategories: false,
        }),
      ).toBe(false);

      const registration = await registerCareReminderCategory(
        { setNotificationCategoryAsync },
        { platformOs: 'web' },
      );

      expect(registration.registered).toBe(false);
      expect(registration.reason).toBe('unsupported_platform');
      expect(setNotificationCategoryAsync).not.toHaveBeenCalled();
    });

    it('clamps snooze duration boundaries safely', () => {
      expect(clampSnoozeMinutes(undefined)).toBe(DEFAULT_CARE_SNOOZE_MINUTES);
      expect(clampSnoozeMinutes(1)).toBe(MIN_CARE_SNOOZE_MINUTES);
      expect(clampSnoozeMinutes(999)).toBe(MAX_CARE_SNOOZE_MINUTES);
      expect(clampSnoozeMinutes(29.6)).toBe(30);

      const actions = getCareReminderCategoryActions({ snoozeMinutes: 2 });
      expect(actions[1].buttonTitle).toBe(`Snooze ${MIN_CARE_SNOOZE_MINUTES} min`);
    });
  });

  describe('privacy-by-default payload construction', () => {
    it('strips sensitive pet and medical details by default (minimal mode)', () => {
      const payload = buildCareReminderActionPayload({
        reminderId: 'rem-101',
        issuedAt: validIssuedAt,
        petId: 'pet-secret-1',
        petName: 'Bella',
        medicationName: 'Apoquel 5mg',
        diagnosis: 'Atopic dermatitis',
        metadata: {
          scheduleSlot: 'morning',
          petName: 'Bella',
          dosage: '5mg',
          location: 'Downtown Vet Clinic',
        },
      });

      expect(payload.privacyMode).toBe(DEFAULT_CARE_PRIVACY_MODE);
      expect(payload.reminderId).toBe('rem-101');
      expect(payload.petName).toBeUndefined();
      expect(payload.medicationName).toBeUndefined();
      expect(payload.metadata).toEqual({ scheduleSlot: 'morning' });
    });

    it('omits all metadata in silent mode and includes opt-in details only in full mode', () => {
      const silentPayload = buildCareReminderActionPayload(
        {
          reminderId: 'rem-102',
          issuedAt: validIssuedAt,
          petName: 'Milo',
          medicationName: 'Heartgard',
          metadata: { scheduleSlot: 'evening' },
        },
        'silent',
      );
      expect(silentPayload.petName).toBeUndefined();
      expect(silentPayload.metadata).toBeUndefined();

      const fullPayload = buildCareReminderActionPayload(
        {
          reminderId: 'rem-102',
          issuedAt: validIssuedAt,
          petName: 'Milo',
          medicationName: 'Heartgard',
        },
        'full',
      );
      expect(fullPayload.petName).toBe('Milo');
      expect(fullPayload.medicationName).toBe('Heartgard');
    });
  });

  describe('stale and malformed payload validation', () => {
    it('detects expired and aged-out notification payloads with recovery instructions', () => {
      const expiredPayload = buildCareReminderActionPayload({
        reminderId: 'rem-expired',
        issuedAt: '2026-10-20T10:00:00.000Z',
        expiresAt: '2026-10-20T11:00:00.000Z',
      });

      const expiredResult = validateCareReminderActionPayload(
        expiredPayload,
        fixedNowMs,
      );
      expect(expiredResult).toEqual({
        status: 'stale',
        reason: 'expired_timestamp',
        reminderId: 'rem-expired',
        recovery: {
          action: 'refresh_reminders',
          announceMessage:
            'This care reminder has expired. Refreshing your care schedule.',
        },
      });

      const oldPayload = buildCareReminderActionPayload({
        reminderId: 'rem-old',
        issuedAt: '2026-10-18T00:00:00.000Z',
      });

      const agedResult = validateCareReminderActionPayload(oldPayload, fixedNowMs);
      expect(agedResult.status).toBe('stale');
      if (agedResult.status === 'stale') {
        expect(agedResult.reason).toBe('exceeded_max_age');
        expect(agedResult.recovery.action).toBe('refresh_reminders');
      }
    });

    it('rejects unknown versions and malformed payloads cleanly', () => {
      const unknownVersion = validateCareReminderActionPayload(
        { version: 99, reminderId: 'rem-1', issuedAt: validIssuedAt },
        fixedNowMs,
      );
      expect(unknownVersion.status).toBe('invalid');
      if (unknownVersion.status === 'invalid') {
        expect(unknownVersion.reason).toBe('unknown_version');
      }

      const malformed = validateCareReminderActionPayload(null, fixedNowMs);
      expect(malformed.status).toBe('invalid');
    });
  });

  describe('action execution, server confirmation, permissions, and offline fallback', () => {
    it('confirms COMPLETE and SNOOZE actions with the server and announces accessibility status', async () => {
      const confirmOnServer = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        confirmed: true,
        serverTimestamp: '2026-10-20T12:00:01.000Z',
      });
      const dismissNotification = jest.fn();
      const announceAccessibility = jest.fn();

      const payload = buildCareReminderActionPayload({
        reminderId: 'rem-200',
        issuedAt: validIssuedAt,
        snoozeMinutes: 20,
      });

      const completeResult = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_COMPLETE,
        rawPayload: payload,
        nowMs: fixedNowMs,
        confirmOnServer,
        dismissNotification,
        announceAccessibility,
      });

      expect(completeResult).toEqual({
        status: 'confirmed',
        reminderId: 'rem-200',
        action: CARE_ACTION_COMPLETE,
        serverConfirmed: true,
        serverTimestamp: '2026-10-20T12:00:01.000Z',
        announcement: 'Care reminder marked as complete.',
      });
      expect(dismissNotification).toHaveBeenCalledWith('rem-200');
      expect(announceAccessibility).toHaveBeenCalledWith(
        'Care reminder marked as complete.',
      );

      const snoozeResult = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_SNOOZE,
        rawPayload: payload,
        nowMs: fixedNowMs,
        confirmOnServer,
        dismissNotification,
        announceAccessibility,
      });

      expect(snoozeResult.status).toBe('confirmed');
      if (snoozeResult.status === 'confirmed') {
        expect(snoozeResult.snoozedUntil).toBe('2026-10-20T12:20:00.000Z');
      }
    });

    it('handles server-confirmed permission denial and server-side stale state cleanly', async () => {
      const payload = buildCareReminderActionPayload({
        reminderId: 'rem-denied',
        issuedAt: validIssuedAt,
      });

      const deniedResult = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_COMPLETE,
        rawPayload: payload,
        nowMs: fixedNowMs,
        confirmOnServer: jest.fn().mockResolvedValue({
          ok: false,
          status: 403,
          permissionDenied: true,
        }),
      });

      expect(deniedResult.status).toBe('denied');
      if (deniedResult.status === 'denied') {
        expect(deniedResult.reason).toBe('permission_denied');
        expect(deniedResult.recovery.action).toBe('reauthenticate_or_sync');
      }

      const serverStaleResult = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_SNOOZE,
        rawPayload: payload,
        nowMs: fixedNowMs,
        confirmOnServer: jest.fn().mockResolvedValue({
          ok: false,
          status: 409,
          stale: true,
        }),
      });

      expect(serverStaleResult.status).toBe('stale');
      if (serverStaleResult.status === 'stale') {
        expect(serverStaleResult.reason).toBe('server_stale');
        expect(serverStaleResult.recovery.action).toBe('refresh_reminders');
      }
    });

    it('preserves offline behavior by queueing actions when offline or after transient retry failures', async () => {
      const enqueueOffline = jest.fn();
      const payload = buildCareReminderActionPayload({
        reminderId: 'rem-offline',
        issuedAt: validIssuedAt,
        snoozeMinutes: 15,
      });

      const offlineResult = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_SNOOZE,
        rawPayload: payload,
        nowMs: fixedNowMs,
        isOnline: false,
        confirmOnServer: jest.fn(),
        enqueueOffline,
      });

      expect(offlineResult.status).toBe('queued_offline');
      expect(enqueueOffline).toHaveBeenCalledWith({
        reminderId: 'rem-offline',
        action: CARE_ACTION_SNOOZE,
        snoozeMinutes: 15,
        queuedAt: '2026-10-20T12:00:00.000Z',
      });

      // Transient network failure that succeeds on retry
      let attempts = 0;
      const flakyServer = jest.fn().mockImplementation(async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('Network timeout');
        }
        return { ok: true, status: 200, confirmed: true };
      });

      const retrySuccess = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_COMPLETE,
        rawPayload: payload,
        nowMs: fixedNowMs,
        maxRetries: 2,
        confirmOnServer: flakyServer,
      });

      expect(retrySuccess.status).toBe('confirmed');
      expect(flakyServer).toHaveBeenCalledTimes(2);
    });

    it('deduplicates repeated taps within the idempotency window', async () => {
      const confirmOnServer = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        confirmed: true,
      });
      const payload = buildCareReminderActionPayload({
        reminderId: 'rem-dedup',
        issuedAt: validIssuedAt,
      });

      const first = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_COMPLETE,
        rawPayload: payload,
        nowMs: fixedNowMs,
        confirmOnServer,
      });
      const duplicate = await executeCareReminderAction({
        actionIdentifier: CARE_ACTION_COMPLETE,
        rawPayload: payload,
        nowMs: fixedNowMs + 10_000,
        confirmOnServer,
      });

      expect(first.status).toBe('confirmed');
      expect(duplicate.status).toBe('duplicate');
      expect(confirmOnServer).toHaveBeenCalledTimes(1);
    });
  });
});
