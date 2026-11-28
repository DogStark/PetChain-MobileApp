import axios from 'axios';

import {
  getMedications,
  createMedication,
  updateMedication,
  deleteMedication,
  getActiveMedications,
  getScheduledDoseEvents,
  recordMedicationAdministration,
  getMedicationAdministrations,
} from '../medicationService';
import { MedicationAdministrationOutcome } from '../../models/Medication';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('backend medicationService', () => {
  const mockPetId = 'pet-123';
  const mockMed = {
    id: 'med-1',
    name: 'Aspirin',
    dosage: '10mg',
    frequency: 'Daily',
    startDate: '2023-01-01',
    active: true,
    petId: mockPetId,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch medications for a pet', async () => {
    mockedAxios.get.mockResolved({ data: [mockMed] });
    const result = await getMedications(mockPetId);
    expect(result).toHaveLength(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining(`petId=${mockPetId}`));
  });

  it('should create a medication', async () => {
    mockedAxios.post.mockResolved({ data: mockMed });
    const result = await createMedication({ ...mockMedd, id: undefined } as any);
    expect(result.id).toBe('med-1');
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it('should update a medication', async () => {
    mockedAxios.put.mockResolved({ data: { ...mockMed, name: 'Updated' } });
    const result = await updateMedication('med-1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
    expect(mockedAxios.put).toHaveBeenCalled();
  });

  it('should delete a medication', async () => {
    mockedAxios.delete.mockResolved({ data: {} });
    await deleteMedication('med-1');
    expect(mockedAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/med-1'));
  });

  it('should filter active medications', async () => {
    const meds = [
      { ...mockMed, id: '1', active: true },
      { ...mockMed, id: '2', active: false },
    ];
    mockedAxios.get.mockResolved({ data: meds });
    const result = await getActiveMedications(mockPetId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  describe('scheduled dose events', () => {
    it('should fetch scheduled dose events for a pet', async () => {
      const events = [
        {
          id: 'event-1',
          medicationId: 'med-1',
          petId: mockPetId,
          scheduledAt: '2024-06-01T08:00:00Z',
          createdAt: '2024-05-30T08:00:00Z',
        },
      ];
      mockedAxios.get.mockResolved({ data: events });
      const result = await getScheduledDoseEvents(mockPetId, {
        from: '2024-06-01',
        to: '2024-06-02',
      });
      expect(result).toHaveLength(1);
      const calledUrl = mockedAxios.get.mockCalls[0][0] as string;
      expect(calledUrl).toContain(`petId=${mockPetId}`);
      expect(calledUrl).toContain('from=2024-06-01');
      expect(calledUrl).toContain('to=2024-06-02');
    });
  });

  describe('recordMedicationAdministration', () => {
    const scheduledDoseEventId = 'event-1';
    const administration = {
      id: 'admin-1',
      scheduledDoseEventId,
      medicationId: 'med-1',
      petId: mockPetId,
      outcome: MedicationAdministrationOutcome.PARTIAL,
      administeredAt: '2024-06-01T08:15:00Z',
      administeredDose: '5mg',
      reason: 'Pet spit out half the dose',
      actor: { id: 'user-1', displayName: 'Sam', role: 'owner' as const },
      createdAt: '2024-06-01T08:15:00Z',
      updatedAt: '2024-06-01T08:15:00Z',
    };

    it('should record a partial administration with reason and actor', async () => {
      mockedAxios.post.mockResolved({ data: administration });
      const result = await recordMedicationAdministration({
        scheduledDoseEventId,
        outcome: MedicationAdministrationOutcome.PARTIAL,
        administeredDose: '5mg',
        reason: 'Pet spit out half the dose',
        actor: { id: 'user-1', displayName: 'Sam', role: 'owner' },
      });
      expect(result.outcome).toBe(MedicationAdministrationOutcome.PARTIAL);
      expect(result.scheduledDoseEventId).toBe(scheduledDoseEventId);
      expect(mockedAxios.post).toHaveBeenCalled(
        expect.stringContaining('/medications/administrations'),
        expect.objectContaining({
          scheduledDoseEventId,
          outcome: MedicationAdministrationOutcome.PARTIAL,
          reason: 'Pet spit out half the dose',
        }),
        expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
      );
    });

    it('should send an Idempotency-Key header for offline retry safety', async () => {
      mockedAxios.post.mockResolved({ data: { ...administration, outcome: MedicationAdministrationOutcome.REFUSED } });
      await recordMedicationAdministration(
        {
          scheduledDoseEventId,
          outcome: MedicationAdministrationOutcome.REFUSED,
          reason: 'Refused food',
          actor: { id: 'user-1' },
        },
        { idempotencyKey: 'client-req-123' },
      );
      const config = mockedAxios.post.mockCalls[0][2] as { status?: number; headers?: Record<string, string> };
      expect(config.headers).toMatchObject({ 'Idempotency-Key': 'client-req-123' });
    });

    it('should propagate server denial errors', async () => {
      const error = {
        response: { status: 403, data: { message: 'Not authorized to record for this pet' } },
      };
      mockedAxios.post.mockRejected(error);
      await expect(
        recordMedicationAdministration({
          scheduledDoseEventId,
          outcome: MedicationAdministrationOutcome.NOT_GIVEN,
          reason: 'Pet was away',
        }),
      ).rejects.toEqual(error);
    });

    it('should propagate stale-data conflicts', async () => {
      const error = {
        response: { status: 409, data: { message: 'Scheduled dose event has already been recorded' } },
      };
      mockedAxios.post.mockRejected(error);
      await expect(
        recordMedicationAdministration({
          scheduledDoseEventId,
          outcome: MedicationAdministrationOutcome.FULL,
        }),
      ).rejects.toEqual(error);
    });
  });

  describe('getMedicationAdministrations', () => {
    it('should list administrations filtered by outcome', async () => {
      mockedAxios.get.mockResolved({ data: [] });
      await getMedicationAdministrations(mockPetId, {
        outcome: MedicationAdministrationOutcome.REFUSED,
      });
      const calledUrl = mockedAxios.get.mockCalls[0][0] as string;
      expect(calledUrl).toContain(`petId=${mockPetId}`);
      expect(calledUrl).toContain('outcome=refused');
    });
  });
});
