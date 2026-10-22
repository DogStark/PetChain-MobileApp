/**
 * Wallet activity filter tests — Issue #1159
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
import {
  getActivityAccessibilityLabel,
  getActivityViewState,
  getEmptyStateMessage,
  loadFilteredActivity,
  loadNextActivityPage,
  validateFilters,
} from '../walletActivityFilterService';

const mockApi = api as unknown as { get: jest.Mock };
const online = networkMonitor.isOnline as jest.Mock;
const item = (id: string, status: string) => ({
  id,
  petId: 'pet-1',
  amount: '12.5',
  asset: 'XLM',
  status,
  createdAt: '2026-10-01T10:00:00Z',
});
const page = {
  items: [item('t1', 'confirmed'), item('t2', 'pending'), item('t3', 'unknown')],
  links: { next: '/wallet/activity?cursor=abc' },
};

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  online.mockResolvedValue(true);
});

it('sends filters to the server and follows the server next link', async () => {
  mockApi.get.mockResolvedValueOnce({ data: page });
  const filters = {
    petId: 'pet-1',
    from: '2026-10-01',
    to: '2026-10-31',
    status: 'pending' as const,
  };
  const res = await loadFilteredActivity(filters);
  expect(mockApi.get).toHaveBeenCalledWith('/wallet/activity', { params: filters });
  expect(res.data?.items.map((i) => i.id)).toEqual(['t1', 't2']);
  expect(res.data?.nextLink).toBe('/wallet/activity?cursor=abc');

  mockApi.get.mockResolvedValueOnce({ data: { items: [], links: {} } });
  await expect(loadNextActivityPage(res.data!.nextLink!)).resolves.toEqual({
    items: [],
    nextLink: null,
  });
  expect(mockApi.get).toHaveBeenLastCalledWith('/wallet/activity?cursor=abc');
});

it('ignores unsafe server links', async () => {
  mockApi.get.mockResolvedValue({ data: { items: [], links: { next: 'https://evil.example/x' } } });
  expect((await loadFilteredActivity({})).data?.nextLink).toBeNull();
  await expect(loadNextActivityPage('https://evil.example/x')).resolves.toBeNull();
});

it('validates filter boundaries', () => {
  expect(validateFilters({ from: '2026-10-01', to: '2026-10-01' })).toEqual([]);
  expect(validateFilters({ from: '2026-10-02', to: '2026-10-01' })).toEqual([
    'Start date must be on or before the end date.',
  ]);
  expect(validateFilters({ from: '10/01/2026' })).toEqual(['Start date is invalid.']);
});

it('exposes transparent empty and pending states', () => {
  expect(getActivityViewState([])).toBe('empty');
  expect(getEmptyStateMessage({}, 'empty')).toBe('No wallet activity yet.');
  expect(getEmptyStateMessage({ status: 'failed' }, 'empty')).toBe(
    'No transactions match these filters.',
  );
  const pending = [{ ...item('p', 'pending'), status: 'pending' as const }];
  expect(getActivityViewState(pending)).toBe('pending-only');
  expect(getEmptyStateMessage({}, 'pending-only')).toMatch(/pending/);
  expect(getActivityAccessibilityLabel(pending[0])).toBe('12.5 XLM, pending, 2026-10-01');
});

it('serves cached results per filter while offline', async () => {
  mockApi.get.mockResolvedValue({ data: page });
  await loadFilteredActivity({ petId: 'pet-1' }, { now: 0 });
  online.mockResolvedValue(false);
  const cached = await loadFilteredActivity({ petId: 'pet-1' }, { now: 20 * 60 * 1000 });
  expect(cached).toMatchObject({ status: 'offline', isStale: true });
  expect((await loadFilteredActivity({ petId: 'pet-2' })).data).toBeNull();
});

it('reports denial without leaking cached activity', async () => {
  mockApi.get.mockResolvedValueOnce({ data: page });
  await loadFilteredActivity({});
  mockApi.get.mockRejectedValue(Object.assign(new Error('no'), { response: { status: 403 } }));
  expect(await loadFilteredActivity({})).toMatchObject({ status: 'denied', data: null });
  online.mockResolvedValue(false);
  expect((await loadFilteredActivity({})).data).toBeNull();
});
