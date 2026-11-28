/**
 * Saved clinic offline notes tests — Issue #1152
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
import { formatLastRefreshed } from '../offlineServerCache';
import {
  getSavedClinics,
  refreshSavedClinic,
  removeSavedClinic,
  saveClinicForOffline,
  setNavigationNote,
} from '../savedClinicService';

const mockApi = api as unknown as { get: jest.Mock };
const online = networkMonitor.isOnline as jest.Mock;
const clinic = {
  id: 'c1',
  name: 'Harbor Vets',
  address: '1 Dock St',
  phone: '555-0100',
  ownerNotes: 'x',
};
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  online.mockResolvedValue(true);
});

it('saves a clinic and lists it offline with its refresh time and note', async () => {
  mockApi.get.mockResolvedValue({ data: clinic });
  await saveClinicForOffline('c1', { now: 0 });
  await setNavigationNote('c1', '  Parking at rear  ');
  online.mockResolvedValue(false);

  const [entry] = await getSavedClinics(2 * 60 * 60 * 1000);
  expect(entry.clinic).toEqual({
    id: 'c1',
    name: 'Harbor Vets',
    address: '1 Dock St',
    phone: '555-0100',
    navigationNote: 'Parking at rear',
  });
  expect(entry.lastRefreshedLabel).toBe('Last refreshed 2 hours ago');
  expect(entry.isStale).toBe(false);
});

it('flags clinics older than a week as stale', async () => {
  mockApi.get.mockResolvedValue({ data: clinic });
  await saveClinicForOffline('c1', { now: 0 });
  const [entry] = await getSavedClinics(8 * DAY);
  expect(entry.isStale).toBe(true);
});

it('does not save when offline or when the payload is invalid', async () => {
  online.mockResolvedValue(false);
  expect((await saveClinicForOffline('c1')).status).toBe('offline');
  online.mockResolvedValue(true);
  mockApi.get.mockResolvedValue({ data: { id: 'c1', name: 'No address' } });
  expect((await saveClinicForOffline('c1')).status).toBe('error');
  expect(await getSavedClinics()).toEqual([]);
});

it('keeps the last good copy when a refresh fails', async () => {
  mockApi.get.mockResolvedValueOnce({ data: clinic });
  await saveClinicForOffline('c1', { now: 0 });
  mockApi.get.mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 400 } }));
  const res = await refreshSavedClinic('c1', { now: 1000 });
  expect(res).toMatchObject({ status: 'error', lastRefreshedAt: 0 });
  expect(res.data?.name).toBe('Harbor Vets');
});

it('removes the saved clinic when the server denies access', async () => {
  mockApi.get.mockResolvedValueOnce({ data: clinic });
  await saveClinicForOffline('c1');
  await setNavigationNote('c1', 'note');
  mockApi.get.mockRejectedValue(Object.assign(new Error('no'), { response: { status: 401 } }));
  expect((await refreshSavedClinic('c1')).status).toBe('denied');
  expect(await getSavedClinics()).toEqual([]);
});

it('removes clinics and notes on request', async () => {
  mockApi.get.mockResolvedValue({ data: clinic });
  await saveClinicForOffline('c1');
  await removeSavedClinic('c1');
  expect(await getSavedClinics()).toEqual([]);
});

it('formats refresh time boundaries', () => {
  expect(formatLastRefreshed(null)).toBe('Never refreshed');
  expect(formatLastRefreshed(0, 30_000)).toBe('Last refreshed just now');
  expect(formatLastRefreshed(0, 60_000)).toBe('Last refreshed 1 minute ago');
  expect(formatLastRefreshed(0, 2 * DAY)).toBe('Last refreshed 2 days ago');
});
