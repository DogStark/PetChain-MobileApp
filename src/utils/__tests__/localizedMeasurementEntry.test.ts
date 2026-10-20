import {
  buildAccessibleMeasurementEntryLabel,
  changeDraftUnit,
  commitMeasurementEntry,
  createMeasurementEntryDraft,
  formatNumberForLocaleInput,
  formatStoredMeasurementDisplay,
  getDefaultUnitForLocale,
  normalizeLocaleDigits,
  parseLocaleNumber,
  parseLocalizedDateInput,
  parseLocalizedTimeInput,
  redactMeasurementContext,
  syncDraftLocaleWithoutSilentConversion,
  updateMeasurementDraftText,
  validateMeasurementEntryPermission,
} from '../localizedMeasurementEntry';

describe('localizedMeasurementEntry (issue #1197)', () => {
  const now = 1_700_000_000_000;

  describe('locale-aware number parsing and formatting', () => {
    it('parses decimal points in en-US and decimal commas in es-ES', () => {
      expect(parseLocaleNumber('12.5', 'en-US')).toBe(12.5);
      expect(parseLocaleNumber('12,5', 'es-ES')).toBe(12.5);
      expect(formatNumberForLocaleInput(12.5, 'en-US')).toBe('12.5');
      expect(formatNumberForLocaleInput(12.5, 'es-ES')).toBe('12,5');
    });

    it('normalizes and parses Eastern Arabic digits and decimal separators (ar-SA)', () => {
      expect(normalizeLocaleDigits('١٢٫٧٥')).toBe('12.75');
      expect(parseLocaleNumber('١٢٫٧٥', 'ar-SA')).toBe(12.75);
    });

    it('rejects malformed or ambiguous multi-separator strings', () => {
      expect(parseLocaleNumber('', 'en-US')).toBeNull();
      expect(parseLocaleNumber('12.3.4', 'en-US')).toBeNull();
      expect(parseLocaleNumber('12,3,4', 'es-ES')).toBeNull();
      expect(parseLocaleNumber('1,234.56', 'en-US')).toBeNull();
      expect(parseLocaleNumber('abc', 'en-US')).toBeNull();
    });
  });

  describe('avoiding silent conversion during editing & preserving unambiguous stored units', () => {
    it('selects locale-appropriate default unit on fresh draft creation', () => {
      expect(getDefaultUnitForLocale('weight', 'en-US')).toBe('lb');
      expect(getDefaultUnitForLocale('weight', 'es-ES')).toBe('kg');
      expect(getDefaultUnitForLocale('temperature', 'en-US')).toBe('fahrenheit');
      expect(getDefaultUnitForLocale('temperature', 'ar-SA')).toBe('celsius');
    });

    it('does not silently convert rawInput or entryUnit when locale changes mid-edit', () => {
      let draft = createMeasurementEntryDraft('weight', 'en-US');
      draft = updateMeasurementDraftText(draft, '22.0');
      expect(draft.entryUnit).toBe('lb');

      // User switches app locale to es-ES while actively editing "22.0"
      const afterLocaleSwitch = syncDraftLocaleWithoutSilentConversion(draft, 'es-ES');
      expect(afterLocaleSwitch.rawInput).toBe('22.0');
      expect(afterLocaleSwitch.entryUnit).toBe('lb');
      expect(afterLocaleSwitch.localeTag).toBe('es-ES');
    });

    it('preserves exact enteredValue and enteredUnit when re-editing a stored record', () => {
      const initialDraft = updateMeasurementDraftText(
        createMeasurementEntryDraft('weight', 'en-US'),
        '10',
      );
      const committed = commitMeasurementEntry(initialDraft, { now });
      expect(committed.ok).toBe(true);
      expect(committed.record?.enteredValue).toBe(10);
      expect(committed.record?.enteredUnit).toBe('lb');
      expect(committed.record?.canonicalUnit).toBe('kg');
      expect(committed.record?.canonicalValue).toBeCloseTo(4.5359, 4);

      // Re-opening for edit in es-ES preserves the original entered 10 lb without drift
      const reEditDraft = createMeasurementEntryDraft('weight', 'es-ES', committed.record);
      expect(reEditDraft.entryUnit).toBe('lb');
      expect(reEditDraft.rawInput).toBe('10');
    });

    it('changes unit without rewriting typed digits unless convertValue=true is explicitly requested', () => {
      let draft = createMeasurementEntryDraft('weight', 'en-US');
      draft = updateMeasurementDraftText(draft, '10');

      const switchedWithoutConversion = changeDraftUnit(draft, 'kg');
      expect(switchedWithoutConversion.entryUnit).toBe('kg');
      expect(switchedWithoutConversion.rawInput).toBe('10');

      const switchedWithConversion = changeDraftUnit(draft, 'kg', { convertValue: true });
      expect(switchedWithConversion.entryUnit).toBe('kg');
      expect(switchedWithConversion.rawInput).toBe('4.54');
    });

    it('formats stored measurement with unambiguous unit symbol', () => {
      const draft = updateMeasurementDraftText(
        createMeasurementEntryDraft('temperature', 'es-ES'),
        '38,5',
      );
      const committed = commitMeasurementEntry(draft, { now });
      expect(committed.ok).toBe(true);

      expect(
        formatStoredMeasurementDisplay(committed.record!, 'es-ES', { preferEnteredUnit: true }),
      ).toContain('°C');
      expect(formatStoredMeasurementDisplay(committed.record!, 'en-US')).toContain('101.3 °F');
    });
  });

  describe('server-confirmed permissions, denial, stale-data, and offline continuity', () => {
    it('commits when server-confirmed write permission is fresh', () => {
      const draft = updateMeasurementDraftText(
        createMeasurementEntryDraft('weight', 'es-ES'),
        '8,4',
      );
      const res = commitMeasurementEntry(draft, {
        now,
        permissionContext: {
          serverConfirmed: true,
          canWrite: true,
          confirmedAt: now - 10_000,
        },
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe('committed');
      expect(res.record?.pendingOfflineSync).toBeUndefined();
    });

    it('queues measurement offline when device is offline with cached write grant', () => {
      const draft = updateMeasurementDraftText(
        createMeasurementEntryDraft('dosage_volume', 'en-US'),
        '2.5',
      );
      const res = commitMeasurementEntry(draft, {
        now,
        permissionContext: {
          serverConfirmed: false,
          canWrite: false,
          confirmedAt: null,
          isOffline: true,
          offlineCachedWriteGrant: true,
        },
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe('queued_offline');
      expect(res.record?.pendingOfflineSync).toBe(true);
    });

    it('rejects commit with permission_denied when server write permission is denied', () => {
      const draft = updateMeasurementDraftText(
        createMeasurementEntryDraft('weight', 'en-US'),
        '15',
      );
      const res = commitMeasurementEntry(draft, {
        now,
        permissionContext: {
          serverConfirmed: true,
          canWrite: false,
          confirmedAt: now - 5_000,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.status).toBe('permission_denied');
      expect(res.retryable).toBe(false);
    });

    it('rejects commit with stale_data and retryable=true when server confirmation is expired', () => {
      const draft = updateMeasurementDraftText(
        createMeasurementEntryDraft('weight', 'en-US'),
        '15',
      );
      const res = commitMeasurementEntry(draft, {
        now,
        permissionContext: {
          serverConfirmed: true,
          canWrite: true,
          confirmedAt: now - 10 * 60 * 1000,
          staleAfterMs: 5 * 60 * 1000,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.status).toBe('stale_data');
      expect(res.retryable).toBe(true);
    });

    it('rejects out-of-range clinical measurements as retryable validation_error', () => {
      const extremeWeight = updateMeasurementDraftText(
        createMeasurementEntryDraft('weight', 'es-ES'),
        '500',
      );
      const res = commitMeasurementEntry(extremeWeight, { now });
      expect(res.ok).toBe(false);
      expect(res.status).toBe('validation_error');
      expect(res.retryable).toBe(true);

      const PermCheck = validateMeasurementEntryPermission({
        serverConfirmed: false,
        canWrite: false,
        confirmedAt: null,
        isOffline: true,
        offlineCachedWriteGrant: false,
      });
      expect(PermCheck.allowed).toBe(false);
      expect(PermCheck.status).toBe('denied');
    });
  });

  describe('localized date and time entry parsing & boundary cases', () => {
    it('parses MM/DD/YYYY in en-US and DD/MM/YYYY in es-ES and ar-SA', () => {
      const usDate = parseLocalizedDateInput('03/15/2026', 'en-US');
      expect(usDate).toEqual({
        valid: true,
        isoDate: '2026-03-15',
        year: 2026,
        month: 3,
        day: 15,
      });

      const esDate = parseLocalizedDateInput('15/03/2026', 'es-ES');
      expect(esDate).toEqual({
        valid: true,
        isoDate: '2026-03-15',
        year: 2026,
        month: 3,
        day: 15,
      });

      const arDate = parseLocalizedDateInput('١٥/٠٣/٢٠٢٦', 'ar-SA');
      expect(arDate.valid).toBe(true);
      expect(arDate.isoDate).toBe('2026-03-15');
    });

    it('validates leap-year calendar boundaries accurately', () => {
      expect(parseLocalizedDateInput('2024-02-29', 'en-US').valid).toBe(true);
      expect(parseLocalizedDateInput('2025-02-29', 'en-US').valid).toBe(false);
      expect(parseLocalizedDateInput('31/04/2026', 'es-ES').valid).toBe(false);
    });

    it('parses 12-hour and 24-hour localized times and rejects invalid hours/minutes', () => {
      expect(parseLocalizedTimeInput('2:30 PM')).toEqual({
        valid: true,
        isoTime: '14:30',
        hours24: 14,
        minutes: 30,
      });
      expect(parseLocalizedTimeInput('12:05 AM')).toEqual({
        valid: true,
        isoTime: '00:05',
        hours24: 0,
        minutes: 5,
      });
      expect(parseLocalizedTimeInput('١٤:٤٥')).toEqual({
        valid: true,
        isoTime: '14:45',
        hours24: 14,
        minutes: 45,
      });
      expect(parseLocalizedTimeInput('13:00 PM').valid).toBe(false);
      expect(parseLocalizedTimeInput('24:00').valid).toBe(false);
      expect(parseLocalizedTimeInput('10:60').valid).toBe(false);
    });
  });

  describe('accessibility labels and privacy redaction', () => {
    it('builds screen-reader labels with full unit names and redacts sensitive identifiers', () => {
      const draft = updateMeasurementDraftText(
        createMeasurementEntryDraft('weight', 'es-ES'),
        '6,2',
      );
      const label = buildAccessibleMeasurementEntryLabel({
        fieldLabel: 'Pet weight',
        draft,
        contextNote: 'microchip 985112003456789 owner jane@example.com',
      });

      expect(label).toContain('Pet weight: 6,2 kilograms');
      expect(label).not.toContain('985112003456789');
      expect(label).not.toContain('jane@example.com');
      expect(label).toContain('[redacted-microchip]');
      expect(label).toContain('[redacted-email]');
      expect(redactMeasurementContext(null)).toBe('');
    });
  });
});
