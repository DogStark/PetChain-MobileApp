import {
  detectScheduleConflicts,
  hasScheduleConflict,
  type MedicationDoseSchedule,
} from '../src/services/medicationScheduleConflict';

describe('medication schedule conflict detection', () => {
  const base: MedicationDoseSchedule = {
    id: 'dose-1',
    medicineId: 'med-1',
    medicineName: 'Amoxicillin',
    time: '08:00',
    durationMinutes: 30,
  };

  it('returns no conflicts for a single schedule', () => {
    expect(detectScheduleConflicts([base])).toEqual([]);
    expect(hasScheduleConflict([base])).toBe(false);
  });

  it('detects duplicate times for the same medicine', () => {
    const duplicate: MedicationDoseSchedule = {
      ...base,
      id: 'dose-2',
    };

    const conflicts = detectScheduleConflicts([base, duplicate]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('duplicate-time');
    expect(conflicts[0].medicineId).toBe('med-1');
    expect(conflicts[0].doseIds).toEqual(['dose-1', 'dose-2']);
    expect(hasScheduleConflict([base, duplicate])).toBe(true);
  });

  it('detects overlapping time ranges for the same medicine', () => {
    const overlapping: MedicationDoseSchedule = {
      ...base,
      id: 'dose-2',
      time: '08:15',
      durationMinutes: 30,
    };

    const conflicts = detectScheduleConflicts([base, overlapping]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('overlap');
    expect(conflicts[0].doseIds).toEqual(['dose-1', 'dose-2']);
  });

  it('does not flag adjacent schedules that only touch at the boundary', () => {
    const adjacent: MedicationDoseSchedule = {
      ...base,
      id: 'dose-2',
      time: '08:30',
      durationMinutes: 30,
    };

    expect(detectScheduleConflicts([base, adjacent])).toEqual([]);
  });

  it('ignores schedules for different medicines', () => {
    const otherMedicine: MedicationDoseSchedule = {
      ...base,
      id: 'dose-2',
      medicineId: 'med-2',
      medicineName: 'Prednisone',
    };

    expect(detectScheduleConflicts([base, otherMedicine])).toEqual([]);
  });

  it('handles empty and malformed input without throwing', () => {
    expect(detectScheduleConflicts([])).toEqual([]);
    expect(
      detectScheduleConflicts([
        { ...base, time: 'not-a-time' },
        { ...base, id: 'dose-2', time: '25:99' },
      ]),
    ).toEqual([]);
  });
});
