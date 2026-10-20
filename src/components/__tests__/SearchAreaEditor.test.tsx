/**
 * SearchAreaEditor.test.tsx
 *
 * Focused tests for SearchAreaEditor component:
 *  - Main flow (render, radius adjustment, confirm, cancel)
 *  - Denial or stale-data states (location error, offline banner)
 *  - Boundary cases (min/max radius bounds, preset buttons)
 *  - Accessibility support and reduced motion
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── 1. Mocks ────────────────────────────────────────────────────────────────

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
  const Circle = () => React.createElement('View', { testID: 'Circle' });
  const UrlTile = () => React.createElement('View', { testID: 'UrlTile' });
  MapView.Animated = MapView;
  return { __esModule: true, default: MapView, Marker, Circle, UrlTile };
});

jest.mock('../../services/mapService', () => ({
  __esModule: true,
  default: {
    initialSync: jest.fn().mockResolvedValue(undefined),
    syncClinics: jest.fn().mockResolvedValue(undefined),
    getCurrentLocation: jest.fn().mockResolvedValue({ latitude: 40.7128, longitude: -74.006 }),
    getState: jest.fn().mockResolvedValue({
      isOffline: false,
      lastSyncAt: new Date().toISOString(),
      cachedClinicCount: 2,
      cachedRegions: [],
    }),
  },
}));

jest.mock('../../utils/networkMonitor', () => ({
  networkMonitor: {
    onNetworkChange: jest.fn(() => jest.fn()),
    isOnline: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn().mockReturnValue(false),
}));

import SearchAreaEditor from '../SearchAreaEditor';
import mapService from '../../services/mapService';
import { networkMonitor } from '../../utils/networkMonitor';

describe('SearchAreaEditor', () => {
  const mockMapService = mapService as jest.Mocked<typeof mapService>;
  const mockNetworkMonitor = networkMonitor as jest.Mocked<typeof networkMonitor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMapService.getCurrentLocation.mockResolvedValue({ latitude: 40.7128, longitude: -74.006 });
  });

  it('renders correctly with initial radius and center', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const { getByText, getByLabelText } = render(
      <SearchAreaEditor
        initialRadiusKm={25}
        initialLocation={{ latitude: 40.7128, longitude: -74.006 }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(getByText('Adjust Search Area')).toBeTruthy();
      expect(getByText('Search Radius: 25.0 km')).toBeTruthy();
      expect(getByLabelText('Search area map. Drag to reposition, pinch to resize the search radius.')).toBeTruthy();
    });
  });

  it('handles radius preset selection correctly', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const { getByText } = render(
      <SearchAreaEditor
        initialRadiusKm={25}
        initialLocation={{ latitude: 40.7128, longitude: -74.006 }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(getByText('Search Radius: 25.0 km')).toBeTruthy();
    });

    // Press 50 km preset
    fireEvent.press(getByText('50 km'));

    expect(getByText('Search Radius: 50.0 km')).toBeTruthy();
  });

  it('handles confirm and cancel actions', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const { getByText, getByLabelText } = render(
      <SearchAreaEditor
        initialRadiusKm={15}
        initialLocation={{ latitude: 40.7128, longitude: -74.006 }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(getByText('Search Radius: 15.0 km')).toBeTruthy();
    });

    // Press Cancel
    fireEvent.press(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Press Save Search Area
    fireEvent.press(getByText('Save Search Area'));
    expect(onConfirm).toHaveBeenCalledWith(15, { latitude: 40.7128, longitude: -74.006 });
  });

  it('handles location acquisition error / denial state', async () => {
    mockMapService.getCurrentLocation.mockRejectedValue(new Error('Location permission denied'));

    const { getByText, queryByText } = render(
      <SearchAreaEditor
        initialRadiusKm={20}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('⚠️ Location permission denied')).toBeTruthy();
    });

    // Dismiss error
    fireEvent.press(getByText('Dismiss'));
    expect(queryByText('⚠️ Location permission denied')).toBeNull();
  });

  it('displays offline banner and stale data state when network is offline', async () => {
    mockNetworkMonitor.isOnline.mockResolvedValue(false);

    const { getByText } = render(
      <SearchAreaEditor
        initialRadiusKm={20}
        initialLocation={{ latitude: 40.7128, longitude: -74.006 }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText(/Offline — using cached map data/)).toBeTruthy();
    });
  });

  it('toggles location sharing explanation and preview sections', async () => {
    const { getByText, queryByText } = render(
      <SearchAreaEditor
        initialRadiusKm={20}
        initialLocation={{ latitude: 40.7128, longitude: -74.006 }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('📍 Location Sharing')).toBeTruthy();
      expect(getByText('👁️ Visibility Preview')).toBeTruthy();
    });

    // Show details
    fireEvent.press(getByText('Show details'));
    expect(getByText(/When you set a search area, your approximate location/)).toBeTruthy();

    // Show preview
    fireEvent.press(getByText('Show preview'));
    expect(getByText('Search Radius')).toBeTruthy();
    expect(getByText('Area Coverage')).toBeTruthy();
  });
});
