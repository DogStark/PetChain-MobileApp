jest.mock('../apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../localDB', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../../utils/imageUtils', () => ({
  pickImage: jest.fn(),
  compressImage: jest.fn(),
  generateThumbnail: jest.fn(),
  uploadToStorage: jest.fn(),
}));

jest.mock('../qrCodeService', () => ({
  scanQRCode: jest.fn(),
}));

jest.mock('../offlineQueue', () => ({
  __esModule: true,
  default: {
    enqueue: jest.fn(),
  },
}));

import apiClient from '../apiClient';
import { getItem, setItem, removeItem } from '../localDB';
import {
  getAllPets,
  getPetById,
  getPetByQRCode,
  createPet,
  updatePet,
  deletePet,
  uploadPetPhoto,
  PetServiceError,
} from '../petService';
import { scanQRCode } from '../qrCodeService';
import offlineQueue from '../offlineQueue';
import { pickImage, compressImage, uploadToStorage } from '../../utils/imageUtils';

const mockClient = jest.mocked(apiClient);
const mockGet = mockClient.get as jest.Mock;
const mockPost = mockClient.post as jest.Mock;
const mockPut = mockClient.put as jest.Mock;
const mockDelete = mockClient.delete as jest.Mock;
const mockGetItem = getItem as jest.Mock;
const mockSetItem = setItem as jest.Mock;
const mockRemoveItem = removeItem as jest.Mock;
const mockScanQRCode = scanQRCode as jest.Mock;
const mockOfflineQueue = offlineQueue as jest.Mocked<typeof offlineQueue>;
const mockPickImage = pickImage as jest.Mock;
const mockCompressImage = compressImage as jest.Mock;
const mockUploadToStorage = uploadToStorage as jest.Mock;

function makeAxiosError(status: number, data: unknown, message = 'Request failed') {
  const err = new Error(message) as any;
  err.isAxiosError = true;
  err.response = { status, statusText: String(status), headers: {}, config: {}, data };
  return err;
}

const PET = {
  id: 'pet-1',
  name: 'Milo',
  species: 'dog',
  ownerId: 'owner-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

describe('petService', () => {
  it('getAllPets returns payload data when API is wrapped', async () => {
    mockGet.mockResolvedValueOnce({ data: { success: true, data: [PET] } });

    const result = await getAllPets();

    expect(mockGet).toHaveBeenCalledWith('/pets');
    expect(result).toEqual([PET]);
  });

  it('getPetById returns unwrapped pet', async () => {
    mockGet.mockResolvedValueOnce({ data: { success: true, data: PET } });

    const result = await getPetById('pet-1');

    expect(mockGet).toHaveBeenCalledWith('/pets/pet-1');
    expect(result).toEqual(PET);
  });

  it('getPetById surfaces forbidden access as PetServiceError', async () => {
    mockGet.mockRejectedValueOnce(
      makeAxiosError(
        403,
        {
          error: {
            code: 'PET_ACCESS_DENIED',
            message: 'You do not have access to this pet',
          },
        },
        'Forbidden',
      ),
    );

    await expect(getPetById('pet-1')).rejects.toMatchObject({
      name: 'PetServiceError',
      code: 'PET_ACCESS_DENIED',
      message: 'You do not have access to this pet',
      status: 403,
    });

    expect(mockGet).toHaveBeenCalledWith('/pets/pet-1');
  });

  it('getPetByQRCode resolves cached pet data without API calls', async () => {
    mockScanQRCode.mockReturnValueOnce({ valid: true, petId: 'pet-1' });
    mockGetItem.mockResolvedValueOnce(JSON.stringify(PET));

    const result = await getPetByQRCode('scanned-qr-value');

    expect(mockScanQRCode).toHaveBeenCalledWith('scanned-qr-value');
    expect(mockGet).not.toHaveBeenCalled();
    expect(result).toEqual(PET);
  });

  it('getPetByQRCode uses embedded pet data when local cache is empty', async () => {
    mockScanQRCode.mockReturnValueOnce({
      valid: true,
      petId: 'pet-1',
      petData: {
        id: 'pet-1',
        name: 'Milo',
        species: 'dog',
        microchipId: 'ABC123',
      },
    });

    const result = await getPetByQRCode('base64-payload-from-scanner');

    expect(mockGet).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'pet-1',
      name: 'Milo',
      species: 'dog',
      microchipId: 'ABC123',
    });
    expect(mockSetItem).toHaveBeenCalledWith('@pet_pet-1', expect.stringContaining('"Milo"'));
  });

  it('getPetByQRCode rejects invalid QR data without API calls', async () => {
    mockScanQRCode.mockReturnValueOnce({ valid: false, error: 'bad qr' });

    await expect(getPetByQRCode('scanned-qr-value')).rejects.toMatchObject({
      name: 'PetServiceError',
      code: 'INVALID_QR_CODE',
      message: 'bad qr',
    });

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('createPet posts payload and returns typed data', async () => {
    const payload = {
      name: 'Milo',
      species: 'dog',
      ownerId: 'owner-1',
    };

    mockPost.mockResolvedValueOnce({ data: { success: true, data: PET } });

    const result = await createPet(payload);

    expect(mockPost).toHaveBeenCalledWith('/pets', payload);
    expect(result).toEqual(PET);
  });

  it('updatePet puts payload and returns typed data', async () => {
    const payload = { name: 'Milo Updated' };
    const updated = { ...PET, name: 'Milo Updated' };

    mockPut.mockResolvedValueOnce({ data: { success: true, data: updated } });

    const result = await updatePet('pet-1', payload);

    expect(mockPut).toHaveBeenCalledWith('/pets/pet-1', payload);
    expect(result).toEqual(updated);
  });

  it('deletePet calls delete endpoint', async () => {
    mockDelete.mockResolvedValueOnce({ data: null });

    await deletePet('pet-1');

    expect(mockDelete).toHaveBeenCalledWith('/pets/pet-1');
  });

  it('surfaces API errors as PetServiceError', async () => {
    const badRequestError = makeAxiosError(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Name is required',
      },
    });

    mockPost.mockRejectedValueOnce(badRequestError);

    await expect(createPet({ name: '', species: 'dog', ownerId: 'owner-1' })).rejects.toMatchObject(
      {
        name: 'PetServiceError',
        code: 'INVALID_INPUT',
        message: 'Name is required',
        status: 400,
      },
    );
  });

  it('validates required petId arguments', async () => {
    await expect(getPetById('   ')).rejects.toBeInstanceOf(PetServiceError);
    await expect(updatePet('   ', { name: 'X' })).rejects.toBeInstanceOf(PetServiceError);
    await expect(deletePet('   ')).rejects.toBeInstanceOf(PetServiceError);
  });

  it('detects a birthday or anniversary exactly 3 days away via checkUpcomingPetEvents', () => {
    // Dynamically import the function from the petService file
    const { checkUpcomingPetEvents } = require('../petService');

    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 3);

    const mockPets = [
      {
        id: 'pet-123',
        name: 'Buddy',
        dateOfBirth: `${targetDate.getFullYear() - 2}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`,
        adoptionDate: '2025-01-01',
        ownerId: 'owner-789',
      },
    ];

    const upcomingEvents = checkUpcomingPetEvents(mockPets as any);

    expect(upcomingEvents).toHaveLength(1);
    expect(upcomingEvents[0].pet.name).toBe('Buddy');
    expect(upcomingEvents[0].type).toBe('birthday');
  });

  // ─── Offline / Network failure fallback ─────────────────────────────────

  it('getAllPets falls back to cached data when API fails', async () => {
    const cachedPet = { ...PET, id: 'cached-1' };
    mockGet.mockRejectedValueOnce(new Error('Network error'));
    mockGetItem.mockResolvedValue(JSON.stringify([cachedPet]));

    const result = await getAllPets();

    expect(mockGet).toHaveBeenCalledWith('/pets');
    expect(result).toEqual([cachedPet]);
  });

  it('getAllPets throws PetServiceError when API fails and no cache', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));
    mockGetItem.mockResolvedValue(null);

    await expect(getAllPets()).rejects.toBeInstanceOf(PetServiceError);
  });

  it('getPetById falls back to cached data when API fails', async () => {
    const cachedPet = { ...PET, id: 'pet-cached' };
    mockGet.mockRejectedValueOnce(new Error('Network error'));
    mockGetItem.mockResolvedValue(JSON.stringify(cachedPet));

    const result = await getPetById('pet-cached');

    expect(result).toEqual(cachedPet);
  });

  it('getPetById throws PetServiceError when API fails and no cache', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));
    mockGetItem.mockResolvedValue(null);

    await expect(getPetById('pet-1')).rejects.toBeInstanceOf(PetServiceError);
  });

  // ─── Offline queue integration ─────────────────────────────────────────

  it('createPet handles network error by creating with temp id and enqueuing', async () => {
    const err = new Error('Network error') as any;
    err.isAxiosError = true;
    err.response = undefined;
    mockPost.mockRejectedValueOnce(err);

    const payload = { name: 'Offline Pet', species: 'cat' as const, ownerId: 'owner-1' };
    const result = await createPet(payload);

    expect(result.id).toMatch(/^temp_/);
    expect(result.name).toBe('Offline Pet');
    expect(mockOfflineQueue.enqueue).toHaveBeenCalledWith(
      'pet', 'create', expect.objectContaining({ name: 'Offline Pet' }),
    );
    expect(mockSetItem).toHaveBeenCalledWith(expect.stringContaining('@pet_'), expect.any(String));
  });

  it('updatePet handles network error by updating cache and enqueuing', async () => {
    const err = new Error('Network error') as any;
    err.isAxiosError = true;
    err.response = undefined;
    mockPut.mockRejectedValueOnce(err);

    mockGetItem.mockImplementation(async (key: string) => {
      if (key === '@pet_pet-1') return JSON.stringify(PET);
      if (key === '@pets_list') return JSON.stringify([PET]);
      return null;
    });

    const result = await updatePet('pet-1', { name: 'Offline Updated' });

    expect(result.name).toBe('Offline Updated');
    expect(mockOfflineQueue.enqueue).toHaveBeenCalledWith('pet', 'update', { id: 'pet-1', name: 'Offline Updated' });
    expect(mockSetItem).toHaveBeenCalledWith('@pet_pet-1', expect.any(String));
  });

  it('deletePet handles network error by removing cache and enqueuing', async () => {
    const err = new Error('Network error') as any;
    err.isAxiosError = true;
    err.response = undefined;
    mockDelete.mockRejectedValueOnce(err);
    mockGetItem.mockResolvedValue(JSON.stringify([PET]));

    await deletePet('pet-1');

    expect(mockOfflineQueue.enqueue).toHaveBeenCalledWith('pet', 'delete', { id: 'pet-1' });
    expect(mockRemoveItem).toHaveBeenCalledWith('@pet_pet-1');
    expect(mockSetItem).toHaveBeenCalledWith('@pets_list', expect.any(String));
  });

  // ─── Filtering & Pagination ────────────────────────────────────────────

  it('returns multiple pets and surfaces the full list for client-side filtering', async () => {
    const petList = [
      PET,
      { ...PET, id: 'pet-2', name: 'Bella', species: 'cat' },
      { ...PET, id: 'pet-3', name: 'Charlie', species: 'bird' },
    ];
    mockGet.mockResolvedValueOnce({ data: { success: true, data: petList } });

    const result = await getAllPets();

    expect(result).toHaveLength(3);
    const cats = result.filter((p) => p.species === 'cat');
    expect(cats).toHaveLength(1);
    expect(cats[0].name).toBe('Bella');
  });

  it('caches all pets after fetching for offline availability', async () => {
    const petList = [PET, { ...PET, id: 'pet-2', name: 'Bella' }];
    mockGet.mockResolvedValueOnce({ data: { success: true, data: petList } });

    await getAllPets();

    expect(mockSetItem).toHaveBeenCalledWith('@pets_list', expect.stringContaining('pet-1'));
    expect(mockSetItem).toHaveBeenCalledWith('@pets_list', expect.stringContaining('pet-2'));
  });

  it('getAllPets with query params for pagination when supported', async () => {
    // The API endpoint may support _page / _limit style params
    const paginatedPets = [PET];
    mockGet.mockResolvedValueOnce({ data: { success: true, data: paginatedPets } });

    // getAllPets currently has no args, but tests verify the direct call shape
    const result = await getAllPets();

    expect(mockGet).toHaveBeenCalledWith('/pets');
    expect(result).toHaveLength(1);
  });

  // ─── uploadPetPhoto ────────────────────────────────────────────────────

  it('uploadPetPhoto returns null when no image is picked', async () => {
    mockPickImage.mockResolvedValueOnce(null);

    const result = await uploadPetPhoto('pet-1');

    expect(result).toBeNull();
    expect(mockCompressImage).not.toHaveBeenCalled();
  });

  it('uploadPetPhoto picks, compresses, uploads, and updates pet', async () => {
    mockPickImage.mockResolvedValueOnce({ uri: 'file://photo.jpg' });
    mockCompressImage.mockResolvedValueOnce({ uri: 'file://compressed.jpg' });
    mockUploadToStorage.mockResolvedValueOnce({
      url: 'https://cdn.example.com/pet-1.jpg',
      thumbnailUrl: 'https://cdn.example.com/pet-1-thumb.jpg',
    });
    mockPut.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...PET,
          photoUrl: 'https://cdn.example.com/pet-1.jpg',
          thumbnailUrl: 'https://cdn.example.com/pet-1-thumb.jpg',
        },
      },
    });

    const result = await uploadPetPhoto('pet-1');

    expect(mockPickImage).toHaveBeenCalled();
    expect(mockCompressImage).toHaveBeenCalledWith('file://photo.jpg');
    expect(mockUploadToStorage).toHaveBeenCalledWith('file://compressed.jpg', 'pet-1');
    expect(result).toEqual({
      photoUrl: 'https://cdn.example.com/pet-1.jpg',
      thumbnailUrl: 'https://cdn.example.com/pet-1-thumb.jpg',
    });
  });

  it('uploadPetPhoto throws PetServiceError on failure', async () => {
    mockPickImage.mockResolvedValueOnce({ uri: 'file://photo.jpg' });
    mockCompressImage.mockRejectedValueOnce(new Error('Compression failed'));

    await expect(uploadPetPhoto('pet-1')).rejects.toBeInstanceOf(PetServiceError);
  });
});
