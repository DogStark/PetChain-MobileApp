/**
 * Pet care task deep link tests — Issue #1192
 */

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../utils/networkMonitor', () => ({ networkMonitor: { isOnline: jest.fn() } }));

import api from '../api';
import { networkMonitor } from '../../utils/networkMonitor';
import { parseDeepLink } from '../../navigation/deepLinks';
import { resolvePetTaskLink } from '../petTaskDeepLinkService';

const mockApi = api as unknown as { get: jest.Mock };
const online = networkMonitor.isOnline as jest.Mock;
const LINK = 'petchain://pets/pet_1/tasks/task-9';

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  online.mockResolvedValue(true);
});

describe('resolvePetTaskLink', () => {
  it('parses supported task links and rejects malformed ones', () => {
    expect(parseDeepLink('https://petchain.app/pets/p1/tasks/t1')).toEqual({
      route: 'PetCareTask',
      params: { petId: 'p1', taskId: 't1' },
    });
    expect(parseDeepLink('petchain://pets/p1/tasks/../x')).toBeNull();
    expect(parseDeepLink('petchain://pets/p1/chores/t1')).toBeNull();
  });

  it('opens the task when the server confirms access', async () => {
    mockApi.get.mockResolvedValue({ data: { canView: true } });
    await expect(resolvePetTaskLink(LINK)).resolves.toEqual({
      screen: 'PetCareTask',
      params: { petId: 'pet_1', taskId: 'task-9' },
      offline: false,
    });
  });

  it('falls back safely for invalid links and denied access', async () => {
    expect(await resolvePetTaskLink('https://evil.example/pets/p/tasks/t')).toMatchObject({
      screen: 'PetList',
      reason: 'invalid_link',
    });
    mockApi.get.mockRejectedValue({ response: { status: 403 } });
    expect(await resolvePetTaskLink(LINK)).toMatchObject({
      screen: 'PetList',
      reason: 'no_access',
    });
    mockApi.get.mockResolvedValue({ data: { canView: false } });
    expect(await resolvePetTaskLink(LINK)).toMatchObject({ reason: 'no_access' });
  });

  it('uses last confirmed access offline and requires it otherwise', async () => {
    online.mockResolvedValue(false);
    expect(await resolvePetTaskLink(LINK)).toMatchObject({ reason: 'unverified' });

    online.mockResolvedValue(true);
    mockApi.get.mockResolvedValue({ data: { canView: true } });
    await resolvePetTaskLink(LINK);
    online.mockResolvedValue(false);
    expect(await resolvePetTaskLink(LINK)).toMatchObject({ screen: 'PetCareTask', offline: true });
  });
});
