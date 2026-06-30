import { requestVetApproval, approveDosage, activateApprovedMedication } from '../dosageApprovalService';
import * as vetService from '../vetService';
import * as localDB from '../localDB';
import * as noteService from '../noteService';
import type { DosageResult } from '../../utils/dosageCalculator';

jest.mock('../vetService');
jest.mock('../localDB');
jest.mock('../noteService');

describe('dosageApprovalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestVetApproval', () => {
    const mockDosageResult: DosageResult = {
      dose: 50,
      unit: 'mg',
      doseInMg: 50,
      safetyLevel: 'safe',
      warnings: [],
    };

    const mockParams = {
      petId: 'pet123',
      petName: 'Buddy',
      petWeight: 10.5,
      drugName: 'Carprofen',
      dosageResult: mockDosageResult,
      vetId: 'vet456',
      medicationData: {
        id: 'med789',
        frequency: 12,
        startDate: '2026-06-25T10:00:00.000Z',
        instructions: 'Give with food',
      },
    };

    it('should create approval request and send message to vet', async () => {
      (vetService.sendMessage as jest.Mock).mockResolvedValue({ id: 'msg123' });
      (localDB.upsertMedication as jest.Mock).mockResolvedValue(undefined);

      const result = await requestVetApproval(mockParams);

      expect(result.id).toMatch(/^approval_/);
      expect(result.petId).toBe('pet123');
      expect(result.petName).toBe('Buddy');
      expect(result.petWeight).toBe(10.5);
      expect(result.drugName).toBe('Carprofen');
      expect(result.calculatedDose).toBe('50');
      expect(result.calculatedDoseUnit).toBe('mg');
      expect(result.status).toBe('pending');
      expect(result.vetId).toBe('vet456');
    });

    it('should send formatted message to vet with all details', async () => {
      (vetService.sendMessage as jest.Mock).mockResolvedValue({ id: 'msg123' });
      (localDB.upsertMedication as jest.Mock).mockResolvedValue(undefined);

      await requestVetApproval(mockParams);

      expect(vetService.sendMessage).toHaveBeenCalledWith(
        'vet456',
        expect.objectContaining({
          content: expect.stringContaining('Dosage Approval Request'),
        }),
      );

      const messageCall = (vetService.sendMessage as jest.Mock).mock.calls[0];
      const content = messageCall[1].content;

      expect(content).toContain('Pet: Buddy');
      expect(content).toContain('Weight: 10.5 kg');
      expect(content).toContain('Medication: Carprofen');
      expect(content).toContain('Calculated Dose: 50 mg');
      expect(content).toContain('Safety Level: SAFE');
    });

    it('should include warnings in message when present', async () => {
      const resultWithWarnings: DosageResult = {
        ...mockDosageResult,
        safetyLevel: 'high',
        warnings: ['Dose exceeds maximum safe limit', 'Monitor for side effects'],
      };

      (vetService.sendMessage as jest.Mock).mockResolvedValue({ id: 'msg123' });
      (localDB.upsertMedication as jest.Mock).mockResolvedValue(undefined);

      await requestVetApproval({
        ...mockParams,
        dosageResult: resultWithWarnings,
      });

      const messageCall = (vetService.sendMessage as jest.Mock).mock.calls[0];
      const content = messageCall[1].content;

      expect(content).toContain('⚠️ Warnings:');
      expect(content).toContain('• Dose exceeds maximum safe limit');
      expect(content).toContain('• Monitor for side effects');
    });

    it('should create medication in paused status with pending approval note', async () => {
      (vetService.sendMessage as jest.Mock).mockResolvedValue({ id: 'msg123' });
      (localDB.upsertMedication as jest.Mock).mockResolvedValue(undefined);

      const result = await requestVetApproval(mockParams);

      expect(localDB.upsertMedication).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.medicationId,
          petId: 'pet123',
          name: 'Carprofen',
          dosage: '50 mg',
          status: 'paused',
          notes: expect.stringContaining('Pending vet approval'),
          frequency: 12,
          instructions: 'Give with food',
        }),
      );
    });

    it('should handle missing optional medication data', async () => {
      (vetService.sendMessage as jest.Mock).mockResolvedValue({ id: 'msg123' });
      (localDB.upsertMedication as jest.Mock).mockResolvedValue(undefined);

      const minimalParams = {
        ...mockParams,
        medicationData: {},
      };

      const result = await requestVetApproval(minimalParams);

      expect(result).toBeDefined();
      expect(localDB.upsertMedication).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency: 24, // default
        }),
      );
    });

    it('should throw error when vet message fails', async () => {
      (vetService.sendMessage as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(requestVetApproval(mockParams)).rejects.toThrow('Network error');
    });
  });

  describe('approveDosage', () => {
    it('should create approval with approved status when no modifications', async () => {
      const result = await approveDosage('approval123', undefined, undefined, 'Looks good');

      expect(result.id).toBe('approval123');
      expect(result.status).toBe('approved');
      expect(result.vetNotes).toBe('Looks good');
      expect(result.approvedAt).toBeDefined();
      expect(result.approvedDose).toBeUndefined();
    });

    it('should create approval with modified status when dose is changed', async () => {
      const result = await approveDosage('approval123', '75', 'mg', 'Increased dose for effectiveness');

      expect(result.id).toBe('approval123');
      expect(result.status).toBe('modified');
      expect(result.approvedDose).toBe('75');
      expect(result.approvedDoseUnit).toBe('mg');
      expect(result.vetNotes).toBe('Increased dose for effectiveness');
    });
  });

  describe('activateApprovedMedication', () => {
    it('should activate medication and update dosage', async () => {
      const mockMedication = {
        id: 'med789',
        petId: 'pet123',
        name: 'Carprofen',
        dosage: '50 mg',
        frequency: 12,
        startDate: '2026-06-25T10:00:00.000Z',
        status: 'paused' as const,
        notes: 'Pending vet approval - Request ID: approval123',
      };

      const getMedications = jest.fn().mockResolvedValue([mockMedication]);
      jest.spyOn(require('../medicationService'), 'getMedications').mockImplementation(getMedications);
      (localDB.upsertMedication as jest.Mock).mockResolvedValue(undefined);

      await activateApprovedMedication('med789', '75 mg');

      expect(localDB.upsertMedication).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'med789',
          dosage: '75 mg',
          status: 'active',
          notes: 'Approved by veterinarian',
        }),
      );
    });

    it('should throw error when medication not found', async () => {
      const getMedications = jest.fn().mockResolvedValue([]);
      jest.spyOn(require('../medicationService'), 'getMedications').mockImplementation(getMedications);

      await expect(activateApprovedMedication('nonexistent', '50 mg')).rejects.toThrow('Medication not found');
    });
  });
});
