const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('../../../backend/services/apiClient', () => ({
  __esModule: true,
  default: { get: mockGet, put: mockPut },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('../petService', () => ({
  updatePet: (...args: unknown[]) => mockPut(...args).then((response: { data: unknown }) => response.data),
}));

import {
  choosePetProfileConflict,
  confirmPetProfileMerge,
  startPetProfileMergeReview,
  type PetProfileMergeStorage,
} from '../petProfileMergeService';

const serverPet = {
  id: 'pet-1',
  name: 'Milo',
  species: 'dog',
  breed: 'Beagle',
  ownerId: 'owner-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
const localPet = { ...serverPet, name: 'Milo Jr.' };

function storage(): PetProfileMergeStorage {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet
    .mockResolvedValueOnce({ data: { success: true, data: { canEdit: true } } })
    .mockResolvedValueOnce({ data: { success: true, data: serverPet } });
});

describe('pet profile merge review', () => {
  it('lists differing fields and requires an explicit resolution', async () => {
    const draft = await startPetProfileMergeReview('pet-1', localPet, storage());

    expect(draft.conflicts).toEqual([
      {
        field: 'name',
        baseValue: 'Milo',
        localValue: 'Milo Jr.',
        serverValue: 'Milo',
      },
    ]);
    await expect(confirmPetProfileMerge(draft, storage())).rejects.toMatchObject({
      code: 'UNRESOLVED_CONFLICTS',
    });
  });

  it('does not start a review when the server denies edit permission', async () => {
    mockGet.mockReset();
    mockGet.mockResolvedValueOnce({
      data: { success: true, data: { canEdit: false, reason: 'Pet is managed by a clinic' } },
    });

    await expect(startPetProfileMergeReview('pet-1', localPet, storage())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: 'Pet is managed by a clinic',
    });
  });

  it('submits the selected local value and clears the draft', async () => {
    const draftStorage = storage();
    const draft = await startPetProfileMergeReview('pet-1', localPet, draftStorage);
    const resolved = await choosePetProfileConflict(draft, 'name', 'local', draftStorage);
    mockGet
      .mockResolvedValueOnce({ data: { success: true, data: { canEdit: true } } })
      .mockResolvedValueOnce({ data: { success: true, data: serverPet } });
    mockPut.mockResolvedValueOnce({ data: { ...serverPet, name: 'Milo Jr.' } });

    await confirmPetProfileMerge(resolved, draftStorage);

    expect(mockPut).toHaveBeenCalledWith('pet-1', { name: 'Milo Jr.' });
  });

  it('retains the draft when the server changes before confirmation', async () => {
    const draftStorage = storage();
    const draft = await startPetProfileMergeReview('pet-1', localPet, draftStorage);
    const resolved = await choosePetProfileConflict(draft, 'name', 'local', draftStorage);
    const changedServer = { ...serverPet, breed: 'Labrador' };
    mockGet
      .mockResolvedValueOnce({ data: { success: true, data: { canEdit: true } } })
      .mockResolvedValueOnce({ data: { success: true, data: changedServer } });

    await expect(confirmPetProfileMerge(resolved, draftStorage)).rejects.toMatchObject({
      code: 'STALE_DATA',
    });
  });

  it('returns a stored draft when refresh is offline', async () => {
    const draftStorage = storage();
    const draft = await startPetProfileMergeReview('pet-1', localPet, draftStorage);
    mockGet.mockReset();
    const networkError = Object.assign(new Error('offline'), { isAxiosError: true });
    mockGet.mockRejectedValueOnce(networkError);

    await expect(startPetProfileMergeReview('pet-1', localPet, draftStorage)).resolves.toMatchObject({
      petId: draft.petId,
      offline: true,
    });
  });
});
