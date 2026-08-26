/**
 * #957 — editing a schedule or travelling across timezones (including DST
 * transitions and overnight doses) must not leave overlapping local
 * notification schedules. Reconciliation is by absolute dose identity.
 */
jest.mock('../localDB', () => ({
  getAllMedications: jest.fn(async () => []),
  upsertMedication: jest.fn(async () => {}),
  deleteMedicationById: jest.fn(async () => {}),
  getDoseLogs: jest.fn(async () => []),
  addDoseLog: jest.fn(async () => {}),
}));

import {
  doseIdentityKey,
  reconcileDoseSchedules,
  type ScheduledDose,
} from '../medicationService';

describe('doseIdentityKey', () => {
  it('is identical for the same instant expressed in different timezones', () => {
    // 2026-03-08T07:30:00Z === 2026-03-08 02:30 America/New_York (pre-DST)
    const asUtc: ScheduledDose = { medicationId: 'm', fireDate: '2026-03-08T07:30:00.000Z' };
    const asOffset: ScheduledDose = { medicationId: 'm', fireDate: new Date('2026-03-08T02:30:00.000-05:00') };
    expect(doseIdentityKey(asUtc)).toBe(doseIdentityKey(asOffset));
  });

  it('distinguishes an overnight dose from the next morning dose', () => {
    const night: ScheduledDose = { medicationId: 'm', fireDate: '2026-03-08T04:00:00.000Z' };
    const morning: ScheduledDose = { medicationId: 'm', fireDate: '2026-03-08T13:00:00.000Z' };
    expect(doseIdentityKey(night)).not.toBe(doseIdentityKey(morning));
  });
});

describe('reconcileDoseSchedules', () => {
  it('cancels exact duplicate notifications for the same instant (post-edit stacking)', () => {
    const existing: ScheduledDose[] = [
      { medicationId: 'm', notificationId: 'n1', fireDate: '2026-06-01T09:00:00.000Z' },
      { medicationId: 'm', notificationId: 'n2', fireDate: '2026-06-01T09:00:00.000Z' },
    ];
    const desired: ScheduledDose[] = [{ medicationId: 'm', fireDate: '2026-06-01T09:00:00.000Z' }];

    const { toCancel, toSchedule, keep } = reconcileDoseSchedules(existing, desired);
    expect(toCancel).toEqual(['n2']);
    expect(keep).toEqual(['n1']);
    expect(toSchedule).toHaveLength(0);
  });

  it('keeps DST-equivalent schedules instead of re-creating them on travel', () => {
    // Traveller re-opens the app; the app recomputes the same absolute dose
    // times but from a new device timezone. Nothing should be cancelled or added.
    const existing: ScheduledDose[] = [
      { medicationId: 'm', notificationId: 'n1', fireDate: '2026-03-08T07:00:00.000Z' },
      { medicationId: 'm', notificationId: 'n2', fireDate: '2026-03-08T19:00:00.000Z' },
    ];
    const desired: ScheduledDose[] = [
      { medicationId: 'm', fireDate: new Date('2026-03-08T02:00:00.000-05:00') },
      { medicationId: 'm', fireDate: new Date('2026-03-08T14:00:00.000-05:00') },
    ];

    const { toCancel, toSchedule, keep } = reconcileDoseSchedules(existing, desired);
    expect(toCancel).toHaveLength(0);
    expect(toSchedule).toHaveLength(0);
    expect(keep.sort()).toEqual(['n1', 'n2']);
  });

  it('cancels stale doses and schedules new ones after a schedule change', () => {
    const existing: ScheduledDose[] = [
      { medicationId: 'm', notificationId: 'old', fireDate: '2026-06-01T08:00:00.000Z' },
    ];
    const desired: ScheduledDose[] = [{ medicationId: 'm', fireDate: '2026-06-01T12:00:00.000Z' }];

    const { toCancel, toSchedule } = reconcileDoseSchedules(existing, desired);
    expect(toCancel).toEqual(['old']);
    expect(toSchedule).toEqual([{ medicationId: 'm', fireDate: '2026-06-01T12:00:00.000Z' }]);
  });

  it('is a no-op for an already-consistent overnight schedule', () => {
    const existing: ScheduledDose[] = [
      { medicationId: 'm', notificationId: 'n1', fireDate: '2026-11-01T05:30:00.000Z' },
    ];
    const desired: ScheduledDose[] = [{ medicationId: 'm', fireDate: '2026-11-01T05:30:00.000Z' }];
    const result = reconcileDoseSchedules(existing, desired);
    expect(result).toEqual({ toCancel: [], toSchedule: [], keep: ['n1'] });
  });
});
