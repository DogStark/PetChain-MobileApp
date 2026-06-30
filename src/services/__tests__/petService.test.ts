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

import apiClient from '../apiClient';
import { getItem, setItem } from '../localDB';
import {
  getAllPets,
  getPetById,
  getPetByQRCode,
  createPet,
  updatePet,
  deletePet,
  PetServiceError,
} from '../petService';
import { scanQRCode } from '../qrCodeService';

const mockClient = jest.mocked(apiClient);
const mockGet = mockClient.get as jest.Mock;
const mockPost = mockClient.post as jest.Mock;
const mockPut = mockClient.put as jest.Mock;
const mockDelete = mockClient.delete as jest.Mock;
const mockGetItem = getItem as jest.Mock;
const mockSetItem = setItem as jest.Mock;
const mockScanQRCode = scanQRCode as jest.Mock;

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
});
