/**
 * Travel document expiry reminder tests — Issue #1153
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
  getExpiryState,
  getReuploadPath,
  loadTravelDocumentReminders,
} from '../travelDocumentExpiryService';

const mockApi = api as unknown as { get: jest.Mock };
const online = networkMonitor.isOnline as jest.Mock;
const NOW = Date.parse('2026-10-22T00:00:00Z');
const doc = (id: string, expiresAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  petId: 'pet-1',
  title: `Doc ${id}`,
  expiresAt,
  ...extra,
});
const docs = [
  doc('valid', '2027-06-01T00:00:00Z'),
  doc('soon', '2026-11-01T00:00:00Z', {
    permissions: { canEdit: true },
    links: { reupload: '/pets/pet-1/travel-documents/soon/upload' },
  }),
  doc('expired', '2026-10-01T00:00:00Z', {
    permissions: { canEdit: false },
    links: { reupload: '/pets/pet-1/travel-documents/expired/upload' },
  }),
  doc('external', '2026-10-30T00:00:00Z', {
    permissions: { canEdit: true },
    links: { reupload: 'https://evil.example/upload' },
  }),
  { id: 'bad', petId: 'pet-1', title: 'No date' },
];

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  online.mockResolvedValue(true);
});

it('returns expired and expiring documents sorted by urgency', async () => {
  mockApi.get.mockResolvedValue({ data: { documents: docs } });
  const res = await loadTravelDocumentReminders('pet-1', { now: NOW });
  expect(res.status).toBe('fresh');
  expect(res.reminders.map((r) => [r.document.id, r.state])).toEqual([
    ['expired', 'expired'],
    ['external', 'expiring'],
    ['soon', 'expiring'],
  ]);
  expect(res.reminders[0].accessibilityLabel).toBe('Doc expired has expired. Re-upload required.');
  expect(res.reminders[2].accessibilityLabel).toBe('Doc soon expires in 10 days.');
});

it('only offers a re-upload path with server edit permission and a relative link', async () => {
  mockApi.get.mockResolvedValue({ data: docs });
  const { reminders } = await loadTravelDocumentReminders('pet-1', { now: NOW });
  const byId = Object.fromEntries(
    reminders.map((r) => [r.document.id, getReuploadPath(r.document)]),
  );
  expect(byId).toEqual({
    soon: '/pets/pet-1/travel-documents/soon/upload',
    expired: null,
    external: null,
  });
});

it('treats the expiry day and window edge as boundaries', () => {
  const d = doc('x', '2026-10-22T00:00:00Z') as never;
  expect(getExpiryState(d, NOW).state).toBe('expired');
  const edge = doc('y', '2026-11-21T00:00:00Z') as never;
  expect(getExpiryState(edge, NOW, 30)).toEqual({ state: 'expiring', daysRemaining: 30 });
  expect(getExpiryState(edge, NOW, 29).state).toBe('valid');
});

it('shows cached reminders offline and flags stale data', async () => {
  mockApi.get.mockResolvedValue({ data: docs });
  await loadTravelDocumentReminders('pet-1', { now: NOW });
  online.mockResolvedValue(false);
  const res = await loadTravelDocumentReminders('pet-1', { now: NOW + 2 * 24 * 60 * 60 * 1000 });
  expect(res).toMatchObject({ status: 'offline', isStale: true });
  expect(res.reminders.length).toBe(3);
});

it('returns no reminders and clears the cache on denial', async () => {
  mockApi.get.mockResolvedValueOnce({ data: docs });
  await loadTravelDocumentReminders('pet-1', { now: NOW });
  mockApi.get.mockRejectedValue(Object.assign(new Error('no'), { response: { status: 403 } }));
  const res = await loadTravelDocumentReminders('pet-1', { now: NOW });
  expect(res).toMatchObject({ status: 'denied', reminders: [] });
  expect(mockStore.size).toBe(0);
});
