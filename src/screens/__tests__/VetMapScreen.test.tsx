/**
 * VetMapScreen.test.tsx
 *
 * Integration tests for VetMapScreen. We mock:
 * - react-native           — provides Dimensions, Platform, etc. in Node
 * - react-native-maps      — prevents native bridge calls
 * - mapService             — controls clinic data without real network/storage
 * - appointmentService     — controls slot data
 * - networkMonitor         — controls online/offline state
 * - apiClient              — prevents full axios/expo-constants init chain
 * - All other transitive native modules
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── 1. Mock all native / expo modules BEFORE any imports ────────────────────

// react-native — provide Dimensions and other primitives
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return Object.setPrototypeOf(
    {
      ...RN,
      Dimensions: {
        get: jest.fn().mockReturnValue({ width: 375, height: 812 }),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      Platform: {
        OS: 'ios',
        select: jest.fn((obj: Record<string, unknown>) => obj['ios'] ?? obj['default']),
      },
      Linking: { openURL: jest.fn(), canOpenURL: jest.fn().mockResolvedValue(true) },
      Alert: { alert: jest.fn() },
    },
    RN,
  );
});

jest.mock('react-native-maps', () => {
  const React = require('react');
  const MapView = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', { testID: 'MapView' }, children);
  const Marker = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', { testID: 'Marker' }, children);
  const Callout = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', { testID: 'Callout' }, children);
  const UrlTile = () => React.createElement('View', { testID: 'UrlTile' });
  MapView.Animated = MapView;
  return { __esModule: true, default: MapView, Marker, Callout, UrlTile };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
  requestAuthorization: jest.fn(),
}));

jest.mock('react-native-ssl-pinning', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('abc123'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {}, version: '1.0.0' } },
}));

// Mock the entire apiClient to prevent axios / interceptor chain from initialising
jest.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    request: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
  resilientRequest: jest.fn(),
}));

// ─── 2. Mock our own services ────────────────────────────────────────────────

jest.mock('../../services/mapService');
jest.mock('../../services/appointmentService');
jest.mock('../../utils/networkMonitor', () => ({
  networkMonitor: {
    onNetworkChange: jest.fn(() => jest.fn()),
    isOnline: jest.fn().mockResolvedValue(true),
  },
}));

// ─── 3. Import after mocks ───────────────────────────────────────────────────

import VetMapScreen from '../VetMapScreen';
import mapService, { type VetClinic } from '../../services/mapService';
import { getAvailability } from '../../services/appointmentService';

// ─── 4. Test fixtures ────────────────────────────────────────────────────────

const MOCK_CLINICS: VetClinic[] = [
  {
    id: 'clinic-1',
    name: 'City Emergency Animal Hospital',
    address: '100 Emergency Blvd, Downtown',
    phoneNumber: '555-0100',
    latitude: 40.7128,
    longitude: -74.006,
    type: 'emergency',
    available24h: true,
    rating: 4.7,
  },
  {
    id: 'clinic-2',
    name: 'Greenfield Veterinary Clinic',
    address: '250 Oak Street, Midtown',
    phoneNumber: '555-0200',
    latitude: 40.7158,
    longitude: -74.009,
    type: 'general',
    available24h: false,
    rating: 4.5,
    schedule: {
      monday: { open: '08:00', close: '18:00' },
      tuesday: { open: '08:00', close: '18:00' },
      wednesday: { open: '08:00', close: '18:00' },
      thursday: { open: '08:00', close: '18:00' },
      friday: { open: '08:00', close: '18:00' },
      saturday: { open: '09:00', close: '14:00' },
      sunday: { open: '09:00', close: '14:00' },
    },
  },
  {
    id: 'clinic-3',
    name: 'Uptown Vet Clinic',
    address: '75 Medical Plaza, Uptown',
    phoneNumber: '555-0300',
    latitude: 40.7198,
    longitude: -74.003,
    type: 'general',
    available24h: false,
    rating: 4.9,
    // No schedule — will always resolve as 'closed'
  },
];

// ─── 5. Tests ─────────────────────────────────────────────────────────────────

describe('VetMapScreen UI & Interactions', () => {
  const mockMapService = mapService as jest.Mocked<typeof mapService>;
  const mockGetAvailability = getAvailability as jest.MockedFunction<typeof getAvailability>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockMapService.initialSync.mockResolvedValue(undefined);
    mockMapService.syncClinics.mockResolvedValue(undefined);
    mockMapService.getCurrentLocation.mockResolvedValue({ latitude: 40.7128, longitude: -74.006 });
    mockMapService.getNearbyClinics.mockResolvedValue(MOCK_CLINICS);
    mockMapService.getCachedClinics.mockResolvedValue(MOCK_CLINICS);
    mockMapService.getClinicDetails.mockImplementation(async (id: string) => {
      const found = MOCK_CLINICS.find((c) => c.id === id);
      if (!found) throw new Error(`Clinic ${id} not found`);
      return found;
    });
    mockMapService.getState.mockResolvedValue({
      isOffline: false,
      lastSyncAt: new Date().toISOString(),
      cachedClinicCount: MOCK_CLINICS.length,
      cachedRegions: [],
    });

    mockGetAvailability.mockResolvedValue({
      date: '2026-06-26',
      availableSlots: ['09:00', '10:00'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Test 1: Loading state ──────────────────────────────────────────────────

  it('renders loading state initially, then transitions to the map view', async () => {
    const { getByText, queryByText } = render(<VetMapScreen />);

    // Loading indicator shown immediately
    expect(getByText('Loading nearby clinics…')).toBeTruthy();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await waitFor(() => {
      expect(queryByText('Loading nearby clinics…')).toBeNull();
    });
  });

  // ── Test 2: Status badges ──────────────────────────────────────────────────

  it('renders correct status badges in the fallback list (no map location)', async () => {
    // GPS fails → fallback list shown
    mockMapService.getCurrentLocation.mockRejectedValue(new Error('GPS Error'));

    // Friday 26 June 2026, 12:00 — Greenfield is OPEN (08:00-18:00)
    jest.setSystemTime(new Date('2026-06-26T12:00:00Z'));

    const { getByText } = render(<VetMapScreen />);

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await waitFor(() => {
      // 24h Emergency → '🚨 24h Emergency' badge
      expect(getByText('🚨 24h Emergency')).toBeTruthy();
      // Greenfield open on a Friday at noon → '● Open Now' badge
      expect(getByText('● Open Now')).toBeTruthy();
      // Uptown (no schedule) → '○ Closed' badge
      expect(getByText('○ Closed')).toBeTruthy();
    });
  });

  // ── Test 3: "Open Now" filter toggle ──────────────────────────────────────

  it('filters clinic list in real-time when "Open Now Only" toggle is pressed', async () => {
    // GPS fails → fallback list
    mockMapService.getCurrentLocation.mockRejectedValue(new Error('GPS Error'));

    // Sunday 28 June 2026, 20:00 UTC — PAST Greenfield's 14:00 close, City Emergency always open
    jest.setSystemTime(new Date('2026-06-28T20:00:00Z'));

    const { getByText, queryByText } = render(<VetMapScreen />);

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    // All three clinics visible initially
    await waitFor(() => {
      expect(getByText('City Emergency Animal Hospital')).toBeTruthy();
      expect(getByText('Greenfield Veterinary Clinic')).toBeTruthy();
      expect(getByText('Uptown Vet Clinic')).toBeTruthy();
    });

    // Press the "Open Now Only" toggle
    fireEvent.press(getByText('⚪ Open Now Only'));

    await waitFor(() => {
      // Only 24h Emergency remains (status = 'emergency')
      expect(getByText('City Emergency Animal Hospital')).toBeTruthy();
      // Greenfield and Uptown are closed — filtered out
      expect(queryByText('Greenfield Veterinary Clinic')).toBeNull();
      expect(queryByText('Uptown Vet Clinic')).toBeNull();
    });
  });
});
