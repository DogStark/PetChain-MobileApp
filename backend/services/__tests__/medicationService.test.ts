import axios from 'axios';

import {
  getMedications,
  createMedication,
  updateMedication,
  deleteMedication,
  getActiveMedications,
} from '../medicationService';

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
    mockedAxios.get.mockResolvedValue({ data: [mockMed] });
    const result = await getMedications(mockPetId);
    expect(result).toHaveLength(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining(`petId=${mockPetId}`));
  });

  it('should create a medication', async () => {
    mockedAxios.post.mockResolvedValue({ data: mockMed });
    const result = await createMedication({ ...mockMed, id: undefined } as any);
    expect(result.id).toBe('med-1');
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it('should update a medication', async () => {
    mockedAxios.put.mockResolvedValue({ data: { ...mockMed, name: 'Updated' } });
    const result = await updateMedication('med-1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
    expect(mockedAxios.put).toHaveBeenCalled();
  });

  it('should delete a medication', async () => {
    mockedAxios.delete.mockResolvedValue({ data: {} });
    await deleteMedication('med-1');
    expect(mockedAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/med-1'));
  });

  it('should filter active medications', async () => {
    const meds = [
      { ...mockMed, id: '1', active: true },
      { ...mockMed, id: '2', active: false },
    ];
    mockedAxios.get.mockResolvedValue({ data: meds });
    const result = await getActiveMedications(mockPetId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});
