import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import emergencyService, { type VetClinic } from '../services/emergencyService';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMERGENCY_RADIUS_KM = 20;
const EMERGENCY_MODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Localised national emergency vet lines by country code (ISO 3166-1 alpha-2).
 * Falls back to the ASPCA Poison Control line when the country is unknown.
 */
const NATIONAL_EMERGENCY_LINES: Record<string, { name: string; number: string }> = {
  US: { name: 'ASPCA Animal Poison Control', number: '888-426-4435' },
  GB: { name: 'Animal Poison Line (UK)', number: '01202-509000' },
  AU: { name: 'Animal Poisons Helpline (AU)', number: '1300-869-738' },
  CA: { name: 'Animal Poison Control (CA)', number: '855-764-7661' },
  default: { name: 'ASPCA Animal Poison Control', number: '888-426-4435' },
};

function getNationalEmergencyLine(countryCode?: string) {
  const key = countryCode?.toUpperCase() ?? 'default';
  return NATIONAL_EMERGENCY_LINES[key] ?? NATIONAL_EMERGENCY_LINES['default'];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack?: () => void;
  /** ISO 3166-1 alpha-2 country code for localised fallback line. */
  countryCode?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

const NearbyVetScreen: React.FC<Props> = ({ onBack, countryCode }) => {
  const [allClinics, setAllClinics] = useState<VetClinic[]>([]);
  const [loading, setLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const emergencyExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Emergency mode auto-revert ──────────────────────────────────────────────

  const activateEmergencyMode = useCallback(() => {
    setEmergencyMode(true);
    if (emergencyExpiryRef.current) clearTimeout(emergencyExpiryRef.current);
    emergencyExpiryRef.current = setTimeout(() => {
      setEmergencyMode(false);
    }, EMERGENCY_MODE_TTL_MS);
  }, []);

  const deactivateEmergencyMode = useCallback(() => {
    setEmergencyMode(false);
    if (emergencyExpiryRef.current) {
      clearTimeout(emergencyExpiryRef.current);
      emergencyExpiryRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (emergencyExpiryRef.current) clearTimeout(emergencyExpiryRef.current);
    };
  }, []);

  // ── Clinic fetch ───────────────────────────────────────────────────────────

  const fetchClinics = useCallback(async () => {
    setLoading(true);
    setLocationError(null);
    try {
      const location = await emergencyService.getCurrentLocation();
      const results = await emergencyService.getNearbyVetClinics(
        location.latitude,
        location.longitude,
        EMERGENCY_RADIUS_KM,
      );
      setAllClinics(results);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to find nearby clinics.';
      setLocationError(msg);
      Alert.alert('Location Error', msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClinics();
  }, [fetchClinics]);

  // ── Derived data ───────────────────────────────────────────────────────────

  /** In emergency mode: show 24h clinics only, sorted by distance. */
  const displayClinics = emergencyMode
    ? [...allClinics]
        .filter((c) => c.available24h)
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    : allClinics;

  const noEmergencyClinicsNearby =
    emergencyMode &&
    !loading &&
    !locationError &&
    displayClinics.length === 0;

  const nationalLine = getNationalEmergencyLine(countryCode);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const handleCallNow = useCallback((phoneNumber: string) => {
    const url = `tel:${phoneNumber}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) Linking.openURL(url);
    });
  }, []);

  const renderClinic = useCallback(
    ({ item }: { item: VetClinic }) => (
      <View style={[styles.card, emergencyMode && styles.cardEmergency]}>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.name}</Text>
            {item.available24h && (
              <View style={styles.badge24h}>
                <Text style={styles.badge24hText}>24h</Text>
              </View>
            )}
          </View>
          <Text style={styles.sub}>
            {item.distance !== undefined ? `${item.distance.toFixed(1)} km away` : ''}
            {item.rating ? ` · ⭐ ${item.rating}` : ''}
          </Text>
          <Text style={styles.sub}>{item.address}</Text>
        </View>

        <View style={styles.actions}>
          {item.phoneNumber ? (
            emergencyMode ? (
              /* Prominent "Call Now" in emergency mode */
              <TouchableOpacity
                style={styles.callNowBtn}
                onPress={() => handleCallNow(item.phoneNumber)}
                accessibilityLabel={`Call ${item.name} now`}
                accessibilityRole="button"
              >
                <Text style={styles.callNowText}>📞 Call Now</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.btn, styles.callBtn]}
                onPress={() => emergencyService.callContact(item.phoneNumber)}
                accessibilityLabel={`Call ${item.name}`}
              >
                <Text style={styles.btnText}>📞</Text>
              </TouchableOpacity>
            )
          ) : null}

          {!emergencyMode && (
            <TouchableOpacity
              style={[styles.btn, styles.navBtn]}
              onPress={() => emergencyService.navigateToClinic(item.address)}
              accessibilityLabel={`Navigate to ${item.name}`}
            >
              <Text style={styles.btnText}>🗺️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    ),
    [emergencyMode, handleCallNow],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, emergencyMode && styles.headerEmergency]}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} accessibilityLabel="Go back" style={styles.backBtn}>
            <Text style={[styles.backText, emergencyMode && styles.backTextEmergency]}>
              ‹ Back
            </Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.title, emergencyMode && styles.titleEmergency]}>
          {emergencyMode ? '🚨 Emergency Vets' : 'Nearby Vet Clinics'}
        </Text>
        <TouchableOpacity
          onPress={() => void fetchClinics()}
          disabled={loading}
          accessibilityLabel="Refresh clinics"
          style={styles.refreshBtn}
        >
          <Text style={[styles.refreshText, emergencyMode && styles.refreshTextEmergency]}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Emergency toggle */}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Emergency mode</Text>
        <TouchableOpacity
          style={[styles.togglePill, emergencyMode && styles.togglePillActive]}
          onPress={() => (emergencyMode ? deactivateEmergencyMode() : activateEmergencyMode())}
          accessibilityLabel={`Toggle emergency mode. Currently ${emergencyMode ? 'on' : 'off'}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: emergencyMode }}
        >
          <View style={[styles.toggleDot, emergencyMode && styles.toggleDotActive]} />
        </TouchableOpacity>
        {emergencyMode && (
          <Text style={styles.toggleHint}>24h clinics only · reverts in 10 min</Text>
        )}
      </View>

      {/* Body */}
      {loading ? (
        <ActivityIndicator
          style={styles.loader}
          size="large"
          color={emergencyMode ? '#e53e3e' : '#4299e1'}
        />
      ) : locationError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{locationError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void fetchClinics()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : noEmergencyClinicsNearby ? (
        /* No 24h clinics within 20 km — show national line fallback */
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackIcon}>⚠️</Text>
          <Text style={styles.fallbackTitle}>
            No 24h emergency clinics found within {EMERGENCY_RADIUS_KM} km
          </Text>
          <Text style={styles.fallbackBody}>
            Call your national animal emergency line:
          </Text>
          <TouchableOpacity
            style={styles.fallbackCallBtn}
            onPress={() => handleCallNow(nationalLine.number)}
            accessibilityLabel={`Call ${nationalLine.name}`}
          >
            <Text style={styles.fallbackCallText}>📞 {nationalLine.name}</Text>
            <Text style={styles.fallbackCallNumber}>{nationalLine.number}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayClinics}
          keyExtractor={(item) => item.id}
          renderItem={renderClinic}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No vet clinics found nearby.</Text>
          }
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
        />
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  headerEmergency: { backgroundColor: '#fff5f5', borderBottomColor: '#fed7d7' },
  backBtn: { marginRight: 8 },
  backText: { fontSize: 18, color: '#e53e3e' },
  backTextEmergency: { color: '#c53030' },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#1a202c' },
  titleEmergency: { color: '#c53030' },
  refreshBtn: { padding: 4 },
  refreshText: { fontSize: 22, color: '#e53e3e' },
  refreshTextEmergency: { color: '#c53030' },

  // Emergency toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 10,
  },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: '#4a5568' },
  toggleHint: { fontSize: 11, color: '#e53e3e', flex: 1 },
  togglePill: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#CBD5E0',
    justifyContent: 'center',
    padding: 2,
  },
  togglePillActive: { backgroundColor: '#e53e3e' },
  toggleDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  toggleDotActive: { alignSelf: 'flex-end' },

  // List
  loader: { marginTop: 40 },
  list: { padding: 12 },

  // Card
  card: {
    flexDirection: 'row',
    backgroundColor: '#f7fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    alignItems: 'center',
  },
  cardEmergency: {
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#fed7d7',
  },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  name: { fontSize: 15, fontWeight: '600', color: '#1a202c' },
  badge24h: {
    backgroundColor: '#e53e3e',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badge24hText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 13, color: '#718096' },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  // Normal icon buttons
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callBtn: { backgroundColor: '#48bb78' },
  navBtn: { backgroundColor: '#4299e1' },
  btnText: { fontSize: 18 },

  // Emergency "Call Now" button
  callNowBtn: {
    backgroundColor: '#e53e3e',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callNowText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  // Error
  empty: { textAlign: 'center', color: '#718096', marginTop: 40 },
  errorContainer: { alignItems: 'center', marginTop: 40, paddingHorizontal: 24 },
  errorText: { color: '#e53e3e', textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#e53e3e',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontWeight: '600' },

  // No-emergency-clinics fallback
  fallbackContainer: {
    alignItems: 'center',
    marginTop: 48,
    paddingHorizontal: 32,
  },
  fallbackIcon: { fontSize: 40, marginBottom: 12 },
  fallbackTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#c53030',
    textAlign: 'center',
    marginBottom: 8,
  },
  fallbackBody: {
    fontSize: 13,
    color: '#4a5568',
    textAlign: 'center',
    marginBottom: 16,
  },
  fallbackCallBtn: {
    backgroundColor: '#e53e3e',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  fallbackCallText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  fallbackCallNumber: { fontSize: 13, color: '#fed7d7', marginTop: 2 },
});

export default NearbyVetScreen;
