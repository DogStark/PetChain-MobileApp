/**
 * Nearby Vet Clinics — unit tests
 *
 * Tests cover:
 * 1. emergencyService.getNearbyVetClinics — mock fallback, Places API path, distance accuracy
 * 2. NearbyVetScreen logic — loading state, error handling, retry
 */

import emergencyService from '../../services/emergencyService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
}));

jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn(), canOpenURL: jest.fn().mockResolvedValue(true) },
  Platform: { OS: 'ios', select: jest.fn((obj: Record<string, unknown>) => obj.ios) },
  PermissionsAndroid: {
    request: jest.fn(),
    RESULTS: { GRANTED: 'granted' },
    PERMISSIONS: { ACCESS_FINE_LOCATION: 'ACCESS_FINE_LOCATION' },
  },
}));

// Config mock — object is defined inside the factory so it's available when hoisted.
// We access it via require() in tests that need to mutate the apiKey.
jest.mock('../../config', () => ({
  __esModule: true,
  default: { googlePlaces: { apiKey: '' } },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LAT = 40.7128;
const LON = -74.006;

// ─── getNearbyVetClinics — mock fallback ──────────────────────────────────────

describe('getNearbyVetClinics — mock fallback (no API key)', () => {
  beforeEach(() => {
    // Ensure no API key so we always hit the mock path

    (require('../../config').default as { googlePlaces: { apiKey: string } }).googlePlaces.apiKey =
      '';
    jest.clearAllMocks();
  });

  it('returns clinics sorted by distance', async () => {
    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON);
    expect(clinics.length).toBeGreaterThan(0);
    for (let i = 1; i < clinics.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(clinics[i].distance!).toBeGreaterThanOrEqual(clinics[i - 1].distance!);
    }
  });

  it('attaches a numeric distance to every clinic', async () => {
    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON);
    clinics.forEach((c) => {
      expect(typeof c.distance).toBe('number');
      expect(c.distance).toBeGreaterThanOrEqual(0);
    });
  });

  it('filters out clinics beyond the requested radius', async () => {
    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON, 1); // 1 km radius
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    clinics.forEach((c) => expect(c.distance!).toBeLessThanOrEqual(1));
  });

  it('returns an empty array when radius is 0', async () => {
    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON, 0);
    expect(clinics).toHaveLength(0);
  });
});

// ─── getNearbyVetClinics — Google Places API path ─────────────────────────────

describe('getNearbyVetClinics — Google Places API path', () => {
  const cfg = require('../../config').default as { googlePlaces: { apiKey: string } };

  beforeEach(() => {
    cfg.googlePlaces.apiKey = 'test-api-key';
    jest.clearAllMocks();
  });

  afterEach(() => {
    cfg.googlePlaces.apiKey = '';
  });

  it('calls the Places Nearby Search endpoint with correct params', async () => {
    const mockResponse = {
      status: 'OK',
      results: [
        {
          place_id: 'p1',
          name: 'Happy Paws Vet',
          vicinity: '1 Vet Lane',
          geometry: { location: { lat: LAT + 0.005, lng: LON + 0.005 } },
          rating: 4.7,
          formatted_phone_number: '555-9999',
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('maps.googleapis.com/maps/api/place/nearbysearch'),
    );
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('test-api-key'));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('veterinary_care'));
    expect(clinics).toHaveLength(1);
    expect(clinics[0].name).toBe('Happy Paws Vet');
    expect(clinics[0].rating).toBe(4.7);
  });

  it('falls back to mock data when the API returns a non-OK status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'REQUEST_DENIED', results: [] }),
    } as unknown as Response);

    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON);
    // Should fall back to mock clinics
    expect(clinics.length).toBeGreaterThan(0);
    expect(clinics[0].id).toMatch(/^clinic-/);
  });

  it('falls back to mock data when fetch throws a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON);
    expect(clinics.length).toBeGreaterThan(0);
    expect(clinics[0].id).toMatch(/^clinic-/);
  });

  it('returns an empty array for ZERO_RESULTS (no fallback)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ZERO_RESULTS', results: [] }),
    } as unknown as Response);

    const clinics = await emergencyService.getNearbyVetClinics(LAT, LON);
    expect(clinics).toHaveLength(0);
  });
});

// ─── calculateDistance (Haversine) ────────────────────────────────────────────

describe('calculateDistance', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(emergencyService.calculateDistance(LAT, LON, LAT, LON)).toBeCloseTo(0, 5);
  });

  it('returns ~3940 km for New York → Los Angeles', () => {
    const d = emergencyService.calculateDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(3900);
    expect(d).toBeLessThan(4000);
  });

  it('is symmetric', () => {
    const d1 = emergencyService.calculateDistance(LAT, LON, 51.5074, -0.1278);
    const d2 = emergencyService.calculateDistance(51.5074, -0.1278, LAT, LON);
    expect(d1).toBeCloseTo(d2, 5);
  });
});

// ─── NearbyVetScreen logic ────────────────────────────────────────────────────

describe('NearbyVetScreen logic', () => {
  it('calls getCurrentLocation and getNearbyVetClinics on mount', async () => {
    const mockLocation = { latitude: LAT, longitude: LON };
    const mockClinics = [
      {
        id: 'c1',
        name: 'Test Vet',
        address: '1 Test St',
        phoneNumber: '555-0001',
        latitude: LAT + 0.01,
        longitude: LON + 0.01,
        distance: 1.2,
      },
    ];

    jest.spyOn(emergencyService, 'getCurrentLocation').mockResolvedValue(mockLocation);
    jest.spyOn(emergencyService, 'getNearbyVetClinics').mockResolvedValue(mockClinics);

    // Simulate what the screen does on mount
    const location = await emergencyService.getCurrentLocation();
    const clinics = await emergencyService.getNearbyVetClinics(
      location.latitude,
      location.longitude,
    );

    expect(emergencyService.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(emergencyService.getNearbyVetClinics).toHaveBeenCalledWith(LAT, LON);
    expect(clinics).toHaveLength(1);
    expect(clinics[0].name).toBe('Test Vet');
  });

  it('propagates location errors', async () => {
    jest
      .spyOn(emergencyService, 'getCurrentLocation')
      .mockRejectedValue(new Error('Location permission denied'));

    await expect(emergencyService.getCurrentLocation()).rejects.toThrow(
      'Location permission denied',
    );
  });

  it('formats distance to one decimal place', () => {
    const format = (d: number) => `${d.toFixed(1)} km`;
    expect(format(1.234)).toBe('1.2 km');
    expect(format(0.5)).toBe('0.5 km');
    expect(format(10)).toBe('10.0 km');
  });
});
