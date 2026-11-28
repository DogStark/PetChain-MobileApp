/**
 * SearchAreaEditor.tsx
 *
 * A map-based component that allows pet owners to review and adjust
 * the search radius for lost/found pet reports.
 *
 * Features:
 *  - Interactive map with draggable radius circle
 *  - Location sharing explanation
 *  - Public visibility preview
 *  - Offline-capable with cached map tiles
 *  - Accessibility support (screen readers, reduced motion)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  AccessibilityInfo,
} from 'react-native';
import MapView, {
  Callout,
  Circle,
  Marker,
  Region,
  UrlTile,
  type OnRegionChangeCompleteCallback,
} from 'react-native-maps';
import * as Location from 'expo-location';

import { useReducedMotion } from '../hooks/useReducedMotion';
import mapService, { type Location as MapLocation } from '../services/mapService';
import { networkMonitor } from '../utils/networkMonitor';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const DEFAULT_RADIUS_KM = 25;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 100;

const DEFAULT_DELTA = 0.05;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchAreaEditorProps {
  /** Current search radius in kilometres */
  initialRadiusKm: number;
  /** Initial center location (defaults to current location if not provided) */
  initialLocation?: MapLocation;
  /** Called when user confirms the new search area */
  onConfirm: (radiusKm: number, center: MapLocation) => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Optional title for the editor */
  title?: string;
  /** Optional subtitle/description */
  description?: string;
}

interface SearchAreaEditorState {
  userLocation: MapLocation | null;
  radiusKm: number;
  mapRegion: Region | null;
  isLoading: boolean;
  isLocationLoading: boolean;
  isOffline: boolean;
  lastSyncAt: string | null;
  showExplanation: boolean;
  showPreview: boolean;
  error: string | null;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Calculate the map region delta based on radius in km
 * Approximate: 1 degree ≈ 111 km at equator
 */
function radiusToDelta(radiusKm: number): number {
  return Math.max(0.01, (radiusKm / 111) * 2.5);
}

/**
 * Calculate radius in km from map region delta
 */
function deltaToRadius(delta: number): number {
  return (delta / 2.5) * 111;
}

/**
 * Haversine formula — returns distance in kilometres between two coordinates.
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Component ────────────────────────────────────────────────────────────────

const SearchAreaEditor: React.FC<SearchAreaEditorProps> = ({
  initialRadiusKm = DEFAULT_RADIUS_KM,
  initialLocation,
  onConfirm,
  onCancel,
  title = 'Adjust Search Area',
  description = 'Drag the circle to reposition, pinch to resize. This area determines which lost/found reports you see.',
}) => {
  const prefersReducedMotion = useReducedMotion();
  const mapRef = useRef<MapView>(null);
  const radiusAnim = useRef(new Animated.Value(initialRadiusKm)).current;
  const centerAnim = useRef({ x: 0, y: 0 }).current;

  const [state, setState] = useState<SearchAreaEditorState>({
    userLocation: null,
    radiusKm: initialRadiusKm,
    mapRegion: null,
    isLoading: true,
    isLocationLoading: false,
    isOffline: false,
    lastSyncAt: null,
    showExplanation: false,
    showPreview: false,
    error: null,
  });

  // Derived map region based on center and radius
  const derivedRegion = useMemo((): Region | undefined => {
    const loc = state.userLocation ?? initialLocation;
    if (!loc) return undefined;
    const delta = radiusToDelta(state.radiusKm);
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      latitudeDelta: delta,
      longitudeDelta: delta,
    };
  }, [state.userLocation, state.radiusKm, initialLocation]);

  // ─── Network Status ────────────────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = networkMonitor.onNetworkChange((online) => {
      setState((prev) => ({ ...prev, isOffline: !online }));
      if (online) {
        void syncMapData();
      }
    });

    networkMonitor.isOnline().then((online) => setState((prev) => ({ ...prev, isOffline: !online })));

    return () => unsubscribe();
  }, []);

  // ─── Initial Load ──────────────────────────────────────────────────────────

  useEffect(() => {
    void bootstrap();
  }, []);

  const bootstrap = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      // Initial sync for map tiles
      void mapService.initialSync();

      let location: MapLocation;
      if (initialLocation) {
        location = initialLocation;
      } else {
        setState((prev) => ({ ...prev, isLocationLoading: true }));
        location = await mapService.getCurrentLocation();
      }

      setState((prev) => ({
        ...prev,
        userLocation: location,
        mapRegion: derivedRegion ?? null,
        isLoading: false,
        isLocationLoading: false,
      }));

      const mapState = await mapService.getState();
      setState((prev) => ({ ...prev, lastSyncAt: mapState.lastSyncAt }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load map';
      setState((prev) => ({
        ...prev,
        error: msg,
        isLoading: false,
        isLocationLoading: false,
      }));
      Alert.alert('Map Error', msg);
    }
  };

  const syncMapData = async () => {
    try {
      await mapService.syncClinics(true);
      const mapState = await mapService.getState();
      setState((prev) => ({ ...prev, lastSyncAt: mapState.lastSyncAt }));
    } catch {
      // Non-fatal
    }
  };

  // ─── Map Interactions ──────────────────────────────────────────────────────

  const handleRegionChangeComplete: OnRegionChangeCompleteCallback = useCallback(
    (region) => {
      if (!state.userLocation) return;

      // Calculate new radius from the map region
      const newRadius = deltaToRadius(region.latitudeDelta);
      const clampedRadius = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, newRadius));

      setState((prev) => ({
        ...prev,
        radiusKm: clampedRadius,
        userLocation: {
          latitude: region.latitude,
          longitude: region.longitude,
        },
        mapRegion: region,
      }));

      // Animate radius value
      if (!prefersReducedMotion) {
        radiusAnim.setValue(clampedRadius);
      }
    },
    [state.userLocation, prefersReducedMotion]
  );

  const handleRecenter = async () => {
    setState((prev) => ({ ...prev, isLocationLoading: true }));
    try {
      const location = await mapService.getCurrentLocation();
      setState((prev) => ({
        ...prev,
        userLocation: location,
        isLocationLoading: false,
      }));
      mapRef.current?.animateToRegion(
        {
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: radiusToDelta(state.radiusKm),
          longitudeDelta: radiusToDelta(state.radiusKm),
        },
        prefersReducedMotion ? 0 : 600
      );
    } catch {
      Alert.alert('Location Error', 'Could not get your current location.');
      setState((prev) => ({ ...prev, isLocationLoading: false }));
    }
  };

  const handleConfirm = () => {
    if (!state.userLocation) {
      Alert.alert('Location Required', 'Please wait for location to be acquired.');
      return;
    }
    onConfirm(state.radiusKm, state.userLocation);
  };

  const handleCancel = () => {
    onCancel();
  };

  const toggleExplanation = () => {
    setState((prev) => ({ ...prev, showExplanation: !prev.showExplanation }));
  };

  const togglePreview = () => {
    setState((prev) => ({ ...prev, showPreview: !prev.showPreview }));
  };

  // ─── Render Helpers ────────────────────────────────────────────────────────

  const renderRadiusCircle = () => {
    if (!state.userLocation) return null;

    return (
      <Circle
        key="search-radius"
        center={state.userLocation}
        radius={state.radiusKm * 1000} // Convert km to meters
        strokeWidth={2}
        strokeColor="#2563eb"
        fillColor="rgba(37, 99, 235, 0.1)"
        zIndex={10}
      />
    );
  };

  const renderCenterMarker = () => {
    if (!state.userLocation) return null;

    return (
      <Marker
        key="center-marker"
        coordinate={state.userLocation}
        anchor={{ x: 0.5, y: 0.5 }}
        zIndex={20}
      >
        <View style={styles.centerMarker}>
          <View style={styles.centerMarkerInner} />
        </View>
      </Marker>
    );
  };

  const renderMap = () => {
    if (state.isLoading || !state.userLocation) {
      return (
        <View style={styles.loadingContainer} accessibilityLiveRegion="polite">
          <Text style={styles.loadingText}>
            {state.isLocationLoading ? 'Acquiring location…' : 'Loading map…'}
          </Text>
        </View>
      );
    }

    return (
      <MapView
        ref={mapRef}
        style={styles.map}
        region={derivedRegion!}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation={false}
        showsMyLocationButton={false}
        rotateEnabled={false}
        pitchEnabled={false}
        accessibilityLabel="Search area map. Drag to reposition, pinch to resize the search radius."
        accessibilityHint={description}
      >
        <UrlTile
          urlTemplate={OSM_TILE_URL}
          maximumZ={19}
          flipY={false}
          offlineMode={state.isOffline}
        />
        {renderRadiusCircle()}
        {renderCenterMarker()}
      </MapView>
    );
  };

  const renderExplanation = () => (
    <View style={styles.explanationCard} accessibilityLiveRegion="polite">
      <View style={styles.explanationHeader}>
        <Text style={styles.explanationTitle}>📍 Location Sharing</Text>
        <TouchableOpacity
          onPress={toggleExplanation}
          accessibilityLabel={state.showExplanation ? 'Hide location explanation' : 'Show location explanation'}
          accessibilityExpanded={state.showExplanation}
        >
          <Text style={styles.explanationToggle}>
            {state.showExplanation ? 'Hide' : 'Show'} details
          </Text>
        </TouchableOpacity>
      </View>

      {state.showExplanation && (
        <View style={styles.explanationContent}>
          <Text style={styles.explanationText}>
            When you set a search area, your approximate location (center of the circle) is
            shared with the PetChain network to find nearby lost and found reports.
          </Text>
          <Text style={styles.explanationText}>
            <Text style={styles.bold}>What is shared:</Text> Only the center coordinate and radius —
            not your exact address or identity.
          </Text>
          <Text style={styles.explanationText}>
            <Text style={styles.bold}>What is NOT shared:</Text> Your name, pet details, home address,
            or precise GPS coordinates.
          </Text>
          <Text style={styles.explanationText}>
            <Text style={styles.bold}>You control:</Text> Adjust the radius anytime. A larger radius
            shows more reports but shares a broader area. A smaller radius is more private.
          </Text>
          <Text style={styles.explanationText}>
            Data is transmitted over encrypted connections and stored according to our
            <Text style={styles.linkText}>Privacy Policy</Text>.
          </Text>
        </View>
      )}
    </View>
  );

  const renderPreview = () => {
    if (!state.userLocation) return null;

    // Estimate number of reports in area (mock calculation for preview)
    const estimatedReports = Math.round(Math.PI * state.radiusKm * state.radiusKm * 0.15);

    return (
      <View style={styles.previewCard} accessibilityLiveRegion="polite">
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle}>👁️ Visibility Preview</Text>
          <TouchableOpacity
            onPress={togglePreview}
            accessibilityLabel={state.showPreview ? 'Hide preview' : 'Show preview'}
            accessibilityExpanded={state.showPreview}
          >
            <Text style={styles.previewToggle}>
              {state.showPreview ? 'Hide' : 'Show'} preview
            </Text>
          </TouchableOpacity>
        </View>

        {state.showPreview && (
          <View style={styles.previewContent}>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatValue}>
                {state.radiusKm.toFixed(state.radiusKm >= 10 ? 0 : 1)} km
              </Text>
              <Text style={styles.previewStatLabel}>Search Radius</Text>
            </View>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatValue}>
                {Math.round(Math.PI * state.radiusKm * state.radiusKm)} km²
              </Text>
              <Text style={styles.previewStatLabel}>Area Coverage</Text>
            </View>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatValue}>~{estimatedReports}</Text>
              <Text style={styles.previewStatLabel}>Est. Reports</Text>
            </View>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatValue}>
                {state.userLocation.latitude.toFixed(4)}, {state.userLocation.longitude.toFixed(4)}
              </Text>
              <Text style={styles.previewStatLabel}>Center (approx.)</Text>
            </View>

            <Text style={styles.previewNote}>
              {state.radiusKm <= 5
                ? '🔒 High privacy — only very nearby reports visible'
                : state.radiusKm <= 15
                ? '🔐 Balanced — good coverage with moderate privacy'
                : '🌐 Wide search — maximum coverage, broader location sharing'}
            </Text>

            <Text style={styles.previewNote}>
              Reports outside this circle will not appear in your Lost & Found feed.
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderRadiusControl = () => (
    <View style={styles.radiusControl}>
      <Text style={styles.radiusLabel}>Search Radius: {state.radiusKm.toFixed(1)} km</Text>
      <View style={styles.sliderContainer}>
        <Text style={styles.sliderMin}>{MIN_RADIUS_KM} km</Text>
        <View style={styles.sliderTrack}>
          <Animated.View
            style={[
              styles.sliderFill,
              {
                width: `${((state.radiusKm - MIN_RADIUS_KM) / (MAX_RADIUS_KM - MIN_RADIUS_KM)) * 100}%`,
              },
            ]}
          />
        </View>
        <Text style={styles.sliderMax}>{MAX_RADIUS_KM} km</Text>
      </View>
      <View style={styles.radiusPresets}>
        { [5, 10, 25, 50, 100].map((preset) => (
          <TouchableOpacity
            key={preset}
            style={[
              styles.presetButton,
              state.radiusKm === preset && styles.presetButtonActive,
            ]}
            onPress={() => {
              const clamped = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, preset));
              setState((prev) => ({ ...prev, radiusKm: clamped }));
              if (!prefersReducedMotion) {
                radiusAnim.setValue(clamped);
              }
            }}
            accessibilityLabel={`Set radius to ${preset} km`}
            accessibilityState={{ selected: state.radiusKm === preset }}
          >
            <Text
              style={[
                styles.presetButtonText,
                state.radiusKm === preset && styles.presetButtonTextActive,
              ]}
            >
              {preset} km
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderActionButtons = () => (
    <View style={styles.actionButtons}>
      <TouchableOpacity
        style={styles.cancelButton}
        onPress={handleCancel}
        accessibilityLabel="Cancel and discard changes"
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.confirmButton}
        onPress={handleConfirm}
        accessibilityLabel="Confirm search area changes"
      >
        <Text style={styles.confirmButtonText}>Save Search Area</Text>
      </TouchableOpacity>
    </View>
  );

  const renderOfflineBanner = () =>
    state.isOffline ? (
      <View style={styles.offlineBanner} accessibilityLiveRegion="polite">
        <Text style={styles.offlineBannerText}>
          📡 Offline — using cached map data
          {state.lastSyncAt ? ` (synced ${new Date(state.lastSyncAt).toLocaleDateString()})` : ''}
        </Text>
      </View>
    ) : null;

  const renderError = () =>
    state.error ? (
      <View style={styles.errorBanner} accessibilityLiveRegion="assertive">
        <Text style={styles.errorText}>⚠️ {state.error}</Text>
        <TouchableOpacity style={styles.errorDismiss} onPress={() => setState((p) => ({ ...p, error: null }))}>
          <Text style={styles.errorDismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    ) : null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {renderError()}
      {renderOfflineBanner()}

      <View style={styles.header}>
        <Text style={styles.screenTitle}>{title}</Text>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleCancel}
          accessibilityLabel="Close search area editor"
        >
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      {state.description && <Text style={styles.description}>{description}</Text>}

      <View style={styles.mapContainer}>{renderMap()}</View>

      <View style={styles.infoSection}>
        {renderExplanation()}
        {renderPreview()}
        {renderRadiusControl()}
        {renderActionButtons()}
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: '#374151',
  },
  description: {
    margin: 16,
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
  },
  mapContainer: {
    height: SCREEN_HEIGHT * 0.45,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 12,
  },
  infoSection: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  offlineBanner: {
    backgroundColor: '#744210',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
  },
  offlineBannerText: {
    color: '#fefcbf',
    fontSize: 12,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    flex: 1,
  },
  errorDismiss: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  errorDismissText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  explanationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  explanationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  explanationTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  explanationToggle: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
  },
  explanationContent: {
    gap: 8,
  },
  explanationText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 20,
  },
  bold: {
    fontWeight: '700',
  },
  linkText: {
    color: '#2563eb',
    textDecorationLine: 'underline',
  },
  previewCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#c6f6d5',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#166534',
  },
  previewToggle: {
    fontSize: 13,
    color: '#16a34a',
    fontWeight: '600',
  },
  previewContent: {
    gap: 12,
  },
  previewStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  previewStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#166534',
  },
  previewStatLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  previewNote: {
    fontSize: 12,
    color: '#166534',
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 8,
  },
  radiusControl: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  radiusLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sliderMin: {
    fontSize: 12,
    color: '#6b7280',
    width: 36,
    textAlign: 'right',
  },
  sliderMax: {
    fontSize: 12,
    color: '#6b7280',
    width: 40,
  },
  sliderTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 3,
  },
  radiusPresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  presetButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  presetButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  presetButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  presetButtonTextActive: {
    color: '#fff',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  centerMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 6 },
    }),
  },
  centerMarkerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563eb',
  },
});

export default SearchAreaEditor;