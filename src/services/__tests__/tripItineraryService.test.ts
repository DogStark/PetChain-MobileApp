/**
 * Trip itinerary checklist tests — Issue #1149
 */

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../utils/networkMonitor', () => ({ networkMonitor: { isOnline: jest.fn() } }));

import api from '../api';
import { networkMonitor } from '../../utils/networkMonitor';
import {
  getMissingItems,
  getReadinessAccessibilityLabel,
  loadTripReadiness,
  submitItinerary,
  validateItinerary,
  type TripItineraryInput,
} from '../tripItineraryService';

const mockApi = api as unknown as { get: jest.Mock; post: jest.Mock };
const online = networkMonitor.isOnline as jest.Mock;
const today = new Date('2026-10-22T00:00:00Z');
const input: TripItineraryInput = {
  petId: 'pet-1',
  destination: 'Lisbon',
  departureDate: '2026-11-01',
  returnDate: '2026-11-10',
  transportMode: 'air',
  documents: ['rabies_certificate'],
};
const denied = Object.assign(new Error('forbidden'), { response: { status: 403 } });

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  online.mockResolvedValue(true);
});

describe('validateItinerary', () => {
  it('accepts a valid itinerary', () => {
    expect(validateItinerary(input, today)).toEqual([]);
  });

  it('rejects past departure, inverted dates and empty destination', () => {
    expect(
      validateItinerary(
        { ...input, destination: ' ', departureDate: '2026-10-21', returnDate: '2026-10-01' },
        today,
      ),
    ).toEqual([
      'Destination is required.',
      'Departure date cannot be in the past.',
      'Return date must be on or after the departure date.',
    ]);
  });

  it('allows departure today (boundary)', () => {
    expect(
      validateItinerary({ ...input, departureDate: '2026-10-22', returnDate: undefined }, today),
    ).toEqual([]);
  });
});

describe('submitItinerary', () => {
  it('saves and returns the server trip id', async () => {
    mockApi.post.mockResolvedValue({ data: { id: 'trip-9' } });
    await expect(submitItinerary(input, today)).resolves.toEqual({
      outcome: 'saved',
      tripId: 'trip-9',
    });
  });

  it('does not call the server when offline or invalid', async () => {
    online.mockResolvedValue(false);
    await expect(submitItinerary(input, today)).resolves.toEqual({ outcome: 'offline' });
    const res = await submitItinerary({ ...input, destination: '' }, today);
    expect(res.outcome).toBe('invalid');
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('maps 403 to permission-denied', async () => {
    mockApi.post.mockRejectedValue(denied);
    await expect(submitItinerary(input, today)).resolves.toEqual({ outcome: 'permission-denied' });
  });
});

describe('loadTripReadiness', () => {
  const readiness = {
    tripId: 'trip-9',
    checks: [
      {
        id: 'c1',
        label: 'Rabies certificate',
        status: 'missing',
        documentType: 'rabies_certificate',
      },
      { id: 'c2', label: 'Microchip', status: 'missing' },
      { id: 'c3', label: 'Airline crate', status: 'ready' },
      { id: 'c4', label: 'Health check', status: 'weird' },
    ],
  };

  it('returns server checks and the missing items', async () => {
    mockApi.get.mockResolvedValue({ data: readiness });
    const res = await loadTripReadiness('pet-1', 'trip-9', { now: 1000 });
    expect(res.status).toBe('fresh');
    expect(res.data?.checks[3].status).toBe('pending');
    expect(getMissingItems(res.data!, input.documents).map((c) => c.id)).toEqual(['c2']);
    expect(getReadinessAccessibilityLabel(res.data!.checks[3])).toBe(
      'Health check: awaiting check',
    );
  });

  it('serves stale cached readiness while offline', async () => {
    mockApi.get.mockResolvedValue({ data: readiness });
    await loadTripReadiness('pet-1', 'trip-9', { now: 0 });
    online.mockResolvedValue(false);
    const res = await loadTripReadiness('pet-1', 'trip-9', { now: 7 * 60 * 60 * 1000 });
    expect(res).toMatchObject({ status: 'offline', isStale: true, lastRefreshedAt: 0 });
    expect(res.data?.tripId).toBe('trip-9');
  });

  it('clears cached readiness when the server denies access', async () => {
    mockApi.get.mockResolvedValueOnce({ data: readiness }).mockRejectedValueOnce(denied);
    await loadTripReadiness('pet-1', 'trip-9');
    const res = await loadTripReadiness('pet-1', 'trip-9');
    expect(res).toMatchObject({ status: 'denied', data: null });
    expect(mockStore.size).toBe(0);
  });

  it('retries transient server errors before succeeding', async () => {
    mockApi.get
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 503 } }))
      .mockResolvedValueOnce({ data: readiness });
    const res = await loadTripReadiness('pet-1', 'trip-9', { retryDelayMs: 0 });
    expect(res.status).toBe('fresh');
    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });
});
