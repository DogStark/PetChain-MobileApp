import {
  buildClinicAppointmentTime,
  clinicWallTimeToUTC,
  formatInTimeZone,
  getTimeZoneOffsetMinutes,
  isValidTimeZone,
  validateClinicAppointmentTime,
} from '../appointmentTime';

describe('clinic-timezone appointment time handling (#960)', () => {
  it('validates IANA timezone ids', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('resolves a clinic wall time to the correct UTC instant (standard time)', () => {
    // 2026-01-15 09:00 in New York (EST, UTC-5) => 14:00Z
    const utc = clinicWallTimeToUTC('2026-01-15', '09:00', 'America/New_York');
    expect(utc.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('accounts for DST when resolving a clinic wall time', () => {
    // 2026-07-15 09:00 in New York (EDT, UTC-4) => 13:00Z
    const utc = clinicWallTimeToUTC('2026-07-15', '09:00', 'America/New_York');
    expect(utc.toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('handles the spring-forward DST boundary without shifting the slot', () => {
    // US DST 2026 begins 2026-03-08 02:00 local. A 09:00 appt that day is EDT.
    const payload = buildClinicAppointmentTime('2026-03-08', '09:00', 'America/New_York');
    expect(payload.clinicOffsetMinutes).toBe(-240); // EDT
    const back = formatInTimeZone(new Date(payload.utc), 'America/New_York');
    expect(back).toEqual({ date: '2026-03-08', time: '09:00' });
  });

  it('carries UTC + clinic zone + offset in the wire payload', () => {
    const payload = buildClinicAppointmentTime('2026-01-15', '09:00', 'America/New_York');
    expect(payload).toMatchObject({
      utc: '2026-01-15T14:00:00.000Z',
      clinicTimeZone: 'America/New_York',
      localDate: '2026-01-15',
      localTime: '09:00',
      clinicOffsetMinutes: -300,
    });
  });

  it('getTimeZoneOffsetMinutes reflects DST at the given instant', () => {
    expect(getTimeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(
      -300,
    );
    expect(getTimeZoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(
      -240,
    );
  });

  describe('validateClinicAppointmentTime', () => {
    const good = buildClinicAppointmentTime('2026-01-15', '09:00', 'America/New_York');

    it('accepts a self-consistent payload', () => {
      const res = validateClinicAppointmentTime(good, 'America/New_York');
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it('detects that a device in another zone would display a shifted slot', () => {
      // Traveller in Tokyo viewing a New York clinic slot.
      const res = validateClinicAppointmentTime(good, 'Asia/Tokyo');
      expect(res.valid).toBe(true);
      expect(res.deviceTimeZoneWouldShift).toBe(true);
    });

    it('rejects a payload whose UTC does not match the stated wall time', () => {
      const tampered = { ...good, utc: '2026-01-15T18:00:00.000Z' };
      const res = validateClinicAppointmentTime(tampered, 'America/New_York');
      expect(res.valid).toBe(false);
      expect(res.errors.join(' ')).toMatch(/resolves to/);
    });

    it('rejects a payload with a bad clinic timezone (malformed input)', () => {
      const res = validateClinicAppointmentTime(
        { ...good, clinicTimeZone: 'Mars/Olympus' },
        'America/New_York',
      );
      expect(res.valid).toBe(false);
    });

    it('rejects an inconsistent stored offset', () => {
      const res = validateClinicAppointmentTime(
        { ...good, clinicOffsetMinutes: 0 },
        'America/New_York',
      );
      expect(res.valid).toBe(false);
      expect(res.errors.join(' ')).toMatch(/offset/i);
    });
  });

  it('throws on malformed date/time input', () => {
    expect(() => clinicWallTimeToUTC('15-01-2026', '09:00', 'America/New_York')).toThrow();
    expect(() => clinicWallTimeToUTC('2026-01-15', '9am', 'America/New_York')).toThrow();
    expect(() => clinicWallTimeToUTC('2026-01-15', '09:00', 'Mars/Olympus')).toThrow();
  });
});
