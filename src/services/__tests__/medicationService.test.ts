import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getMedications,
  saveMedication,
  deleteMedication,
  logDose,
  getMedicationEndDate,
  isMedicationActive,
  getScheduleForRange,
  getDaySchedule,
} from '../medicationService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe('medicationService', () => {
  const mockMedication = {
    id: 'med-123',
    petId: 'pet-123',
    name: 'Aspirin',
    dosage: '10mg',
    frequency: 8, // every 8 hours
    startDate: '2023-01-01T00:00:00.000Z',
    status: 'active' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CRUD operations', () => {
    it('should get medications', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([mockMedication]));
      const meds = await getMedications();
      expect(meds).toHaveLength(1);
      expect(meds[0]).toEqual(mockMedication);
    });

    it('should save new medication', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([]));
      await saveMedication(mockMedication);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@medications',
        JSON.stringify([mockMedication]),
      );
    });

    it('should delete medication', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([mockMedication]));
      await deleteMedication('med-123');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('@medications', '[]');
    });
  });

  describe('Dose logging', () => {
    it('should log dose', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('[]');
      const log = { id: 'log-1', medicationId: 'med-123', takenAt: new Date().toISOString() };
      await logDose(log);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('@dose_logs', JSON.stringify([log]));
    });
  });

  describe('Date and Schedule helpers', () => {
    it('should get correct end date', () => {
      expect(
        getMedicationEndDate({ ...mockMedication, endDate: '2023-01-10T00:00:00.000Z' }),
      ).toEqual(new Date('2023-01-10T00:00:00.000Z'));
      expect(getMedicationEndDate(mockMedication)).toBeNull();
    });

    it('should check if medication is active', () => {
      const activeDate = new Date('2023-01-05T00:00:00.000Z');
      const beforeStart = new Date('2022-12-31T23:59:59.000Z');

      expect(isMedicationActive(mockMedication, activeDate)).toBe(true);
      expect(isMedicationActive(mockMedication, beforeStart)).toBe(false);

      const finishedMed = { ...mockMedication, endDate: '2023-01-02T00:00:00.000Z' };
      expect(isMedicationActive(finishedMed, activeDate)).toBe(false);
    });

    it('should calculate schedule for range', () => {
      const from = new Date('2023-01-01T00:00:00.000Z');
      const to = new Date('2023-01-01T23:59:59.000Z');

      const schedule = getScheduleForRange(mockMedication, from, to);
      // 00:00, 08:00, 16:00
      expect(schedule).toHaveLength(3);
      expect(schedule[0].toISOString()).toBe('2023-01-01T00:00:00.000Z');
    });

    it('should calculate day schedule', () => {
      const date = new Date('2023-01-01T12:00:00.000Z');
      const schedule = getDaySchedule(mockMedication, date);
      expect(schedule).toHaveLength(3);
    });
  });
});
