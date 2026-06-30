import { calculateClinicStatus, type ClinicStatus } from '../useClinicStatus';
import { type VetClinic } from '../../services/mapService';

describe('calculateClinicStatus', () => {
  const baseClinic: VetClinic = {
    id: 'clinic-test',
    name: 'Test Vet Clinic',
    address: '123 Test St',
    phoneNumber: '555-1234',
    latitude: 40.7128,
    longitude: -74.006,
    type: 'general',
    available24h: false,
    schedule: {
      monday: { open: '08:00', close: '18:00' },
      tuesday: { open: '08:00', close: '18:00' },
      wednesday: { open: '08:00', close: '18:00' },
      thursday: { open: '08:00', close: '18:00' },
      friday: { open: '08:00', close: '18:00' },
      saturday: { open: '09:00', close: '14:00' },
    },
  };

  // Helper to create a specific Date object
  // Note: Day 1 of month (2026-06-01) was a Monday.
  const makeDate = (
    dayOfWeek: 'monday' | 'sunday' | 'saturday',
    hour: number,
    minute: number,
  ): Date => {
    const d = new Date('2026-06-01T00:00:00Z'); // Start on a Monday
    if (dayOfWeek === 'sunday') {
      d.setUTCDate(d.getUTCDate() - 1); // Go back to Sunday (May 31)
    } else if (dayOfWeek === 'saturday') {
      d.setUTCDate(d.getUTCDate() + 5); // Go forward to Saturday (June 6)
    }
    // We set local hours and minutes because the calculation uses referenceDate.getHours() / getMinutes()
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  it('returns emergency for 24h emergency clinics regardless of schedule or time', () => {
    const emergencyClinic = { ...baseClinic, available24h: true };
    const date = makeDate('monday', 12, 0);
    expect(calculateClinicStatus(emergencyClinic, date)).toBe('emergency');

    const closedDate = makeDate('sunday', 2, 0);
    expect(calculateClinicStatus(emergencyClinic, closedDate)).toBe('emergency');
  });

  it('returns closed when schedule is not defined', () => {
    const noScheduleClinic = { ...baseClinic, schedule: undefined };
    const date = makeDate('monday', 12, 0);
    expect(calculateClinicStatus(noScheduleClinic, date)).toBe('closed');
  });

  it('returns closed on days with no schedule entry', () => {
    // Sunday is not in baseClinic.schedule
    const date = makeDate('sunday', 12, 0);
    expect(calculateClinicStatus(baseClinic, date)).toBe('closed');
  });

  describe('daytime schedules (e.g., 08:00 - 18:00)', () => {
    it('returns closed before opening time', () => {
      const date = makeDate('monday', 7, 59);
      expect(calculateClinicStatus(baseClinic, date)).toBe('closed');
    });

    it('returns open exactly at opening time', () => {
      const date = makeDate('monday', 8, 0);
      expect(calculateClinicStatus(baseClinic, date)).toBe('open');
    });

    it('returns open during regular hours', () => {
      const date = makeDate('monday', 12, 0);
      expect(calculateClinicStatus(baseClinic, date)).toBe('open');
    });

    it('returns open just before the closing soon window (61 minutes before)', () => {
      const date = makeDate('monday', 16, 59); // 61 minutes before 18:00
      expect(calculateClinicStatus(baseClinic, date)).toBe('open');
    });

    it('returns closing_soon exactly 60 minutes before closing', () => {
      const date = makeDate('monday', 17, 0); // 60 minutes before 18:00
      expect(calculateClinicStatus(baseClinic, date)).toBe('closing_soon');
    });

    it('returns closing_soon within 60 minutes of closing', () => {
      const date = makeDate('monday', 17, 30); // 30 minutes before 18:00
      expect(calculateClinicStatus(baseClinic, date)).toBe('closing_soon');
    });

    it('returns closed exactly at closing time', () => {
      const date = makeDate('monday', 18, 0);
      expect(calculateClinicStatus(baseClinic, date)).toBe('closed');
    });

    it('returns closed after closing time', () => {
      const date = makeDate('monday', 19, 0);
      expect(calculateClinicStatus(baseClinic, date)).toBe('closed');
    });
  });

  describe('overnight schedules (e.g., 18:00 - 02:00)', () => {
    const overnightClinic: VetClinic = {
      ...baseClinic,
      schedule: {
        monday: { open: '18:00', close: '02:00' },
      },
    };

    it('returns closed before opening time', () => {
      const date = makeDate('monday', 17, 0);
      expect(calculateClinicStatus(overnightClinic, date)).toBe('closed');
    });

    it('returns open during overnight hours (before midnight)', () => {
      const date = makeDate('monday', 20, 0);
      expect(calculateClinicStatus(overnightClinic, date)).toBe('open');
    });

    it('returns open during overnight hours (after midnight)', () => {
      const date = makeDate('monday', 0, 30); // Monday morning 00:30 (technically Sunday night schedule or Monday early hours)
      expect(calculateClinicStatus(overnightClinic, date)).toBe('open');
    });

    it('returns closing_soon within 60 minutes of overnight closing', () => {
      const date = makeDate('monday', 1, 30); // 1:30 AM is 30 mins before 2:00 AM closing
      expect(calculateClinicStatus(overnightClinic, date)).toBe('closing_soon');
    });

    it('returns closed after overnight closing', () => {
      const date = makeDate('monday', 3, 0);
      expect(calculateClinicStatus(overnightClinic, date)).toBe('closed');
    });
  });
});
