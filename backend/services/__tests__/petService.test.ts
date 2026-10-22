import apiClient from '../apiClient';
import { getPetById, getAllPets, createPet, updatePet, deletePet } from '../petService';

jest.mock('../apiClient');
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('backend petService', () => {
  const mockPet = {
    id: 'pet-123',
    name: 'Buddy',
    species: 'Dog',
    ownerId: 'owner-123',
    qrCode: 'qr-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPetById', () => {
    it('should return pet on success', async () => {
      mockedApiClient.get.mockResolvedValue({ data: mockPet });
      const response = await getPetById('pet-123');
      expect(response.success).toBe(true);
      expect(response.data).toEqual(mockPet);
    });

    it('should return error on failure', async () => {
      mockedApiClient.get.mockRejectedValue(new Error('Network error'));
      const response = await getPetById('pet-123');
      expect(response.success).toBe(false);
      expect(response.error).toBe('Network error');
    });
  });

  describe('getAllPets', () => {
    it('should return list of pets', async () => {
      mockedApiClient.get.mockResolvedValue({ data: [mockPet] });
      const response = await getAllPets('owner-123');
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(mockedApiClient.get).toHaveBeenCalledWith('/pets', {
        params: { ownerId: 'owner-123' },
      });
    });
  });

  describe('createPet', () => {
    it('should create a new pet', async () => {
      const input = { name: 'Buddy', species: 'Dog', ownerId: 'owner-123' };
      mockedApiClient.post.mockResolvedValue({ data: { ...mockPet, ...input } });

      const response = await createPet(input);
      expect(response.success).toBe(true);
      expect(response.data?.name).toBe('Buddy');
    });
  });

  describe('updatePet', () => {
    it('should update an existing pet', async () => {
      const input = { name: 'Max' };
      mockedApiClient.patch.mockResolvedValue({ data: { ...mockPet, ...input } });

      const response = await updatePet('pet-123', input);
      expect(response.success).toBe(true);
      expect(response.data?.name).toBe('Max');
    });
  });

  describe('deletePet', () => {
    it('should delete a pet', async () => {
      mockedApiClient.delete.mockResolvedValue({ data: { success: true } });
      const response = await deletePet('pet-123');
      expect(response.success).toBe(true);
    });
  });
});
