import axios from 'axios';

import { getMedicalRecords, getRecordById, createMedicalRecord } from '../medicalRecordService';

jest.mock('../blockchainService', () => ({
  storeMedicalRecordOnChain: jest.fn().mockResolvedValue(undefined),
  verifyMedicalRecordOnChain: jest.fn(),
}));
jest.mock('../offlineQueue', () => ({
  __esModule: true,
  default: {
    enqueue: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../localDB', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('medicalRecordService', () => {
  const mockPetId = 'pet-123';
  const mockRecord = {
    id: 'rec-123',
    petId: mockPetId,
    type: 'vaccination',
    date: '2023-01-01',
    notes: 'test',
  };
  const mockDocument = {
    id: 'doc-1',
    name: 'lab-results.pdf',
    mimeType: 'application/pdf',
    type: 'pdf',
    url: 'https://example.com/lab-results.pdf',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMedicalRecords', () => {
    it('should fetch medical records with filters', async () => {
      const mockResponse = {
        data: {
          data: [mockRecord],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await getMedicalRecords(mockPetId, { type: 'vaccination' });

      expect(result.data).toHaveLength(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(`/pets/${mockPetId}/medical-records`),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('type=vaccination'));
    });

    it('should throw error if petId is missing', async () => {
      await expect(getMedicalRecords('')).rejects.toThrow('Pet ID is required');
    });

    it('should handle API errors correctly', async () => {
      const error = {
        isAxiosError: true,
        response: { status: 404, data: { message: 'Not Found' } },
      };
      mockedAxios.get.mockRejectedValue(error);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(getMedicalRecords(mockPetId)).rejects.toThrow('Pet or records not found');
    });
  });

  describe('getRecordById', () => {
    it('should fetch record by ID', async () => {
      mockedAxios.get.mockResolvedValue({ data: mockRecord });
      const result = await getRecordById(mockPetId, 'rec-123');
      expect(result).toEqual(mockRecord);
    });
  });

  describe('createMedicalRecord', () => {
    it('should create a new medical record', async () => {
      mockedAxios.post.mockResolvedValue({ data: { ...mockRecord, documents: [mockDocument] } });
      const result = await createMedicalRecord(mockPetId, {
        type: 'vaccination',
        documents: [mockDocument],
      } as any);
      expect(result).toEqual({ ...mockRecord, documents: [mockDocument] });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining(`/pets/${mockPetId}/medical-records`),
        expect.any(Object),
      );
    });
  });
});
