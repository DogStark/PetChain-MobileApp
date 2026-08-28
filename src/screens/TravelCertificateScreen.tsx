/**
 * TravelCertificateScreen
 * Issue #123 — Pet Travel Health Certificate Generator
 *
 * Allows users to:
 * 1. Select a destination country
 * 2. Set a travel date
 * 3. Generate a travel health certificate
 * 4. View compliance status and missing requirements with actionable steps
 * 5. Anchor the certificate to the Stellar blockchain
 * 6. Download/share the PDF certificate
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { getSupportedCountries } from '../data/countryTravelRequirements';
import type {
  TravelHealthCertificate,
  CertificateRequirementCheck,
} from '../models/TravelCertificate';
import {
  generateTravelCertificate,
  getPetTravelCertificates,
  anchorCertificateToBlockchain,
  getCertificatePdfUrl,
  getMissingRequirements,
  getComplianceSummary,
  TravelCertificateError,
} from '../services/travelCertificateService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  petId: string;
  petName?: string;
  onBack: () => void;
}

type Screen = 'list' | 'generate' | 'detail';

type SupportedCountry = ReturnType<typeof getSupportedCountries>[number];

interface RequirementsCache {
  countries: SupportedCountry[];
  cachedAt: string;
}

// ─── Cache constants ──────────────────────────────────────────────────────────

const REQUIREMENTS_CACHE_KEY = '@travel_country_requirements_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_WARN_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Component ────────────────────────────────────────────────────────────────

const TravelCertificateScreen: React.FC<Props> = ({ petId, petName, onBack }) => {
  const [screen, setScreen] = useState<Screen>('list');
  const [certificates, setCertificates] = useState<TravelHealthCertificate[]>([]);
  const [selectedCert, setSelectedCert] = useState<TravelHealthCertificate | null>(null);
  const [loading, setLoading] = useState(false);
  const [anchoring, setAnchoring] = useState(false);

  // Generate form state
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<{ code: string; name: string } | null>(
    null,
  );
  const [travelDate, setTravelDate] = useState('');
  const [countrySearch, setCountrySearch] = useState('');

  // Requirements cache state
  const [countries, setCountries] = useState<SupportedCountry[]>([]);
  const [requirementsCachedAt, setRequirementsCachedAt] = useState<string | null>(null);
  const [requirementsFromCache, setRequirementsFromCache] = useState(false);
  const [requirementsStale, setRequirementsStale] = useState(false);
  const [requirementsRefreshing, setRequirementsRefreshing] = useState(false);

  const filteredCountries = countries.filter((c) =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  // ── Requirements caching ────────────────────────────────────────────────────

  const loadRequirements = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRequirementsRefreshing(true);

    try {
      if (!forceRefresh) {
        const raw = await AsyncStorage.getItem(REQUIREMENTS_CACHE_KEY);
        if (raw) {
          const cached: RequirementsCache = JSON.parse(raw);
          const age = Date.now() - new Date(cached.cachedAt).getTime();
          if (age < CACHE_TTL_MS) {
            setCountries(cached.countries);
            setRequirementsCachedAt(cached.cachedAt);
            setRequirementsFromCache(false);
            setRequirementsStale(age > STALE_WARN_MS);
            return;
          }
        }
      }

      // Fetch fresh (static source; will become a network call in future)
      try {
        const fresh = getSupportedCountries();
        const newCache: RequirementsCache = {
          countries: fresh,
          cachedAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(REQUIREMENTS_CACHE_KEY, JSON.stringify(newCache));
        setCountries(fresh);
        setRequirementsCachedAt(newCache.cachedAt);
        setRequirementsFromCache(false);
        setRequirementsStale(false);
      } catch {
        // Network failure — serve from cache
        const raw = await AsyncStorage.getItem(REQUIREMENTS_CACHE_KEY);
        if (raw) {
          const cached: RequirementsCache = JSON.parse(raw);
          const age = Date.now() - new Date(cached.cachedAt).getTime();
          setCountries(cached.countries);
          setRequirementsCachedAt(cached.cachedAt);
          setRequirementsFromCache(true);
          setRequirementsStale(age > STALE_WARN_MS);
        } else {
          const fallback = getSupportedCountries();
          setCountries(fallback);
          setRequirementsCachedAt(null);
          setRequirementsFromCache(true);
          setRequirementsStale(true);
        }
      }
    } finally {
      if (forceRefresh) setRequirementsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRequirements();
  }, [loadRequirements]);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadCertificates = useCallback(async () => {
    setLoading(true);
    try {
      const certs = await getPetTravelCertificates(petId);
      setCertificates(certs);
    } catch {
      Alert.alert('Error', 'Failed to load travel certificates.');
    } finally {
      setLoading(false);
    }
  }, [petId]);

  useEffect(() => {
    if (screen === 'list') void loadCertificates();
  }, [screen, loadCertificates]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!selectedCountry) {
      Alert.alert('Missing Info', 'Please select a destination country.');
      return;
    }
    if (!travelDate.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(travelDate.trim())) {
      Alert.alert('Missing Info', 'Please enter a valid travel date (YYYY-MM-DD).');
      return;
    }
    if (new Date(travelDate) <= new Date()) {
      Alert.alert('Invalid Date', 'Travel date must be in the future.');
      return;
    }

    setLoading(true);
    try {
      const result = await generateTravelCertificate({
        petId,
        destinationCountryCode: selectedCountry.code,
        travelDate: travelDate.trim(),
      });
      setSelectedCert(result.certificate);
      setScreen('detail');
    } catch (error) {
      const msg =
        error instanceof TravelCertificateError
          ? error.message
          : 'Failed to generate certificate. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Anchor ──────────────────────────────────────────────────────────────────

  const handleAnchor = async () => {
    if (!selectedCert) return;
    Alert.alert(
      'Anchor to Blockchain',
      'This will permanently record this certificate on the Stellar blockchain. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Anchor',
          onPress: async () => {
            setAnchoring(true);
            try {
              const updated = await anchorCertificateToBlockchain(selectedCert.id);
              setSelectedCert(updated);
              Alert.alert('Success', 'Certificate anchored to Stellar blockchain.');
            } catch {
              Alert.alert('Error', 'Failed to anchor certificate. Please try again.');
            } finally {
              setAnchoring(false);
            }
          },
        },
      ],
    );
  };

  // ── Download PDF ────────────────────────────────────────────────────────────

  const handleDownloadPdf = async () => {
    if (!selectedCert) return;
    try {
      const url = await getCertificatePdfUrl(selectedCert.id);
      Alert.alert('PDF Ready', `Certificate PDF available at:\n${url}`);
    } catch {
      Alert.alert('Error', 'Failed to get PDF. Please try again.');
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderCertCard = ({ item }: { item: TravelHealthCertificate }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        setSelectedCert(item);
        setScreen('detail');
      }}
      accessibilityRole="button"
      accessibilityLabel={`Certificate for ${item.destinationCountryName}`}
    >
      <View style={styles.cardRow}>
        <Text style={styles.cardCountry}>{item.destinationCountryName}</Text>
        <View style={[styles.statusBadge, statusBadgeStyle(item.status)]}>
          <Text style={styles.statusBadgeText}>{item.status.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.cardMeta}>Travel: {new Date(item.travelDate).toLocaleDateString()}</Text>
      <Text style={styles.cardMeta}>
        Compliance: {item.complianceScore}% · Generated:{' '}
        {new Date(item.generatedAt).toLocaleDateString()}
      </Text>
      {item.isBlockchainAnchored && (
        <Text style={styles.anchoredBadge}>🔗 Blockchain Anchored</Text>
      )}
    </TouchableOpacity>
  );

  const renderRequirementCheck = (check: CertificateRequirementCheck, idx: number) => (
    <View key={idx} style={[styles.checkRow, check.met ? styles.checkMet : styles.checkMissing]}>
      <View style={styles.checkHeader}>
        <Text style={styles.checkIcon}>{check.met ? '✓' : '✗'}</Text>
        <View style={styles.checkContent}>
          <Text style={styles.checkName}>{check.requirementName}</Text>
          <View style={[styles.typePill, typePillStyle(check.requirementType)]}>
            <Text style={styles.typePillText}>{check.requirementType.replace('_', ' ')}</Text>
          </View>
        </View>
      </View>
      {check.details ? <Text style={styles.checkDetails}>{check.details}</Text> : null}
      {!check.met && check.actionRequired ? (
        <View style={styles.actionBox}>
          <Text style={styles.actionLabel}>Action required:</Text>
          <Text style={styles.actionText}>{check.actionRequired}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderCacheInfo = () => {
    if (!requirementsCachedAt && !requirementsFromCache) return null;

    const cachedDate = requirementsCachedAt ? new Date(requirementsCachedAt) : null;
    const ageMs = cachedDate ? Date.now() - cachedDate.getTime() : Infinity;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    return (
      <>
        {requirementsFromCache && (
          <View style={styles.outdatedBanner}>
            <Text style={styles.outdatedBannerText}>
              ⚠️ Requirements may be outdated — loaded from cache
            </Text>
          </View>
        )}
        {requirementsStale && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleBannerText}>
              🚨 Country requirements are over 7 days old. Verify with official sources before
              travel.
            </Text>
          </View>
        )}
        {cachedDate && (
          <Text style={styles.lastUpdatedText}>
            Last updated:{' '}
            {ageDays === 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays} days ago`}
          </Text>
        )}
      </>
    );
  };

  // ── Screens ─────────────────────────────────────────────────────────────────

  if (screen === 'detail' && selectedCert) {
    const missing = getMissingRequirements(selectedCert);
    const summary = getComplianceSummary(selectedCert);

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setScreen('list')}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Travel Certificate</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView contentContainerStyle={styles.detailBody}>
          {/* Summary card */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryCountry}>{selectedCert.destinationCountryName}</Text>
            <Text style={styles.summaryDate}>
              Travel: {new Date(selectedCert.travelDate).toLocaleDateString()}
            </Text>
            <View style={styles.summaryRow}>
              <View style={[styles.statusBadge, statusBadgeStyle(selectedCert.status)]}>
                <Text style={styles.statusBadgeText}>{selectedCert.status.toUpperCase()}</Text>
              </View>
              <Text style={styles.summaryScore}>{selectedCert.complianceScore}%</Text>
            </View>
            <Text style={styles.summaryMeta}>{summary}</Text>
          </View>

          {/* Missing requirements alert */}
          {missing.length > 0 && (
            <View style={styles.alertBox}>
              <Text style={styles.alertTitle}>
                ⚠️ {missing.length} Missing Requirement{missing.length > 1 ? 's' : ''}
              </Text>
              {missing.map((c, i) => (
                <Text key={i} style={styles.alertItem}>
                  • {c.requirementName}: {c.actionRequired}
                </Text>
              ))}
            </View>
          )}

          {/* All requirement checks */}
          <Text style={styles.sectionTitle}>Requirement Checks</Text>
          {selectedCert.requirementChecks.map(renderRequirementCheck)}

          {/* Blockchain section */}
          <Text style={styles.sectionTitle}>Blockchain</Text>
          {selectedCert.isBlockchainAnchored ? (
            <View style={styles.blockchainCard}>
              <Text style={styles.blockchainTitle}>🔗 Anchored on Stellar</Text>
              <Text style={styles.blockchainMeta}>TX: {selectedCert.blockchainTxHash}</Text>
              <Text style={styles.blockchainMeta}>
                Anchored:{' '}
                {selectedCert.blockchainAnchoredAt
                  ? new Date(selectedCert.blockchainAnchoredAt).toLocaleString()
                  : 'N/A'}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.anchorBtn, anchoring && styles.btnDisabled]}
              onPress={() => void handleAnchor()}
              disabled={anchoring}
              accessibilityRole="button"
              accessibilityLabel="Anchor certificate to Stellar blockchain"
            >
              {anchoring ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.anchorBtnText}>🔗 Anchor to Stellar Blockchain</Text>
              )}
            </TouchableOpacity>
          )}

          {/* PDF download */}
          <TouchableOpacity
            style={styles.pdfBtn}
            onPress={() => void handleDownloadPdf()}
            accessibilityRole="button"
            accessibilityLabel="Download PDF certificate"
          >
            <Text style={styles.pdfBtnText}>📄 Download PDF Certificate</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Certificate ID: {selectedCert.id}
            {'\n'}
            Generated: {new Date(selectedCert.generatedAt).toLocaleString()}
            {'\n'}
            Always verify requirements with official government sources before travel.
          </Text>
        </ScrollView>
      </View>
    );
  }

  if (screen === 'generate') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setScreen('list')}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Certificate</Text>
          <TouchableOpacity
            onPress={() => void loadRequirements(true)}
            disabled={requirementsRefreshing}
            accessibilityRole="button"
            accessibilityLabel="Refresh country requirements"
          >
            {requirementsRefreshing ? (
              <ActivityIndicator size="small" color="#10B981" />
            ) : (
              <Text style={styles.refreshBtn}>↻ Refresh</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.formBody}>
          {renderCacheInfo()}

          <Text style={styles.formLabel}>Destination Country</Text>
          <TouchableOpacity
            style={styles.countrySelector}
            onPress={() => setCountryPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Select destination country"
          >
            <Text
              style={
                selectedCountry ? styles.countrySelectorText : styles.countrySelectorPlaceholder
              }
            >
              {selectedCountry
                ? `${selectedCountry.name} (${selectedCountry.code})`
                : 'Select a country…'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <Text style={styles.formLabel}>Travel Date</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#9CA3AF"
            value={travelDate}
            onChangeText={setTravelDate}
            keyboardType="numeric"
            accessibilityLabel="Travel date"
          />

          <TouchableOpacity
            style={[styles.generateBtn, loading && styles.btnDisabled]}
            onPress={() => void handleGenerate()}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Generate travel health certificate"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.generateBtnText}>Generate Certificate</Text>
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* Country picker modal */}
        <Modal
          visible={countryPickerVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setCountryPickerVisible(false)}
        >
          <View style={styles.overlay}>
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Select Country</Text>
                <TouchableOpacity onPress={() => setCountryPickerVisible(false)}>
                  <Text style={styles.pickerClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.pickerSearch}
                placeholder="Search countries…"
                placeholderTextColor="#9CA3AF"
                value={countrySearch}
                onChangeText={setCountrySearch}
                accessibilityLabel="Search countries"
              />
              <FlatList
                data={filteredCountries}
                keyExtractor={(c) => c.code}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.countryItem,
                      selectedCountry?.code === item.code && styles.countryItemActive,
                    ]}
                    onPress={() => {
                      setSelectedCountry(item);
                      setCountryPickerVisible(false);
                      setCountrySearch('');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                  >
                    <Text
                      style={[
                        styles.countryItemText,
                        selectedCountry?.code === item.code && styles.countryItemTextActive,
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text style={styles.countryCode}>{item.code}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ── List screen ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {petName ? `${petName}'s Travel Certs` : 'Travel Certificates'}
        </Text>
        <TouchableOpacity
          onPress={() => setScreen('generate')}
          accessibilityRole="button"
          accessibilityLabel="New certificate"
        >
          <Text style={styles.newBtn}>+ New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#10B981" />
      ) : (
        <FlatList
          data={certificates}
          keyExtractor={(c) => c.id}
          renderItem={renderCertCard}
          contentContainerStyle={certificates.length === 0 ? styles.emptyContainer : styles.list}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>✈️</Text>
              <Text style={styles.emptyTitle}>No travel certificates yet</Text>
              <Text style={styles.emptySubtitle}>
                Generate a certificate to check if {petName ?? 'your pet'} meets the requirements
                for your destination country.
              </Text>
              <TouchableOpacity
                style={styles.generateBtn}
                onPress={() => setScreen('generate')}
                accessibilityRole="button"
              >
                <Text style={styles.generateBtnText}>Generate Certificate</Text>
              </TouchableOpacity>
            </View>
          }
          onRefresh={() => void loadCertificates()}
          refreshing={loading}
        />
      )}
    </View>
  );
};

// ─── Style helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  ready: { bg: '#D1FAE5', text: '#065F46' },
  incomplete: { bg: '#FEE2E2', text: '#991B1B' },
  anchored: { bg: '#DBEAFE', text: '#1E40AF' },
  anchor_failed: { bg: '#FEF3C7', text: '#92400E' },
  draft: { bg: '#F3F4F6', text: '#374151' },
};

const statusBadgeStyle = (status: string) => {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return { backgroundColor: c.bg };
};

const TYPE_PILL_COLORS: Record<string, { bg: string; text: string }> = {
  vaccination: { bg: '#D1FAE5', text: '#065F46' },
  health_check: { bg: '#E0F2FE', text: '#0369A1' },
  document: { bg: '#F3E8FF', text: '#6B21A8' },
};

const typePillStyle = (type: string) => {
  const c = TYPE_PILL_COLORS[type] ?? { bg: '#F3F4F6', text: '#374151' };
  return { backgroundColor: c.bg };
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1F2937',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backText: { color: '#10B981', fontSize: 16, fontWeight: '600', minWidth: 50 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  newBtn: { color: '#10B981', fontSize: 15, fontWeight: '700', minWidth: 50, textAlign: 'right' },
  refreshBtn: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '600',
    minWidth: 60,
    textAlign: 'right',
  },
  loader: { marginTop: 40 },
  list: { padding: 12 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyState: { alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },

  // Certificate card
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardCountry: { fontSize: 16, fontWeight: '700', color: '#111827', flex: 1 },
  cardMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  anchoredBadge: { fontSize: 11, color: '#1E40AF', marginTop: 4, fontWeight: '600' },

  // Status badge
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: '700', color: '#374151' },

  // Detail
  detailBody: { padding: 16 },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCountry: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 },
  summaryDate: { fontSize: 14, color: '#6B7280', marginBottom: 10 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  summaryScore: { fontSize: 28, fontWeight: '800', color: '#10B981' },
  summaryMeta: { fontSize: 13, color: '#6B7280' },

  alertBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#991B1B', marginBottom: 8 },
  alertItem: { fontSize: 13, color: '#7F1D1D', marginBottom: 4, lineHeight: 18 },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 10,
    marginTop: 8,
  },

  // Requirement checks
  checkRow: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  checkMet: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  checkMissing: { backgroundColor: '#FFF7F7', borderColor: '#FECACA' },
  checkHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkIcon: { fontSize: 16, fontWeight: '700', marginTop: 1 },
  checkContent: { flex: 1 },
  checkName: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 4 },
  checkDetails: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  typePill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  typePillText: { fontSize: 11, fontWeight: '600', color: '#374151', textTransform: 'capitalize' },
  actionBox: {
    marginTop: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    padding: 8,
  },
  actionLabel: { fontSize: 11, fontWeight: '700', color: '#92400E', marginBottom: 2 },
  actionText: { fontSize: 12, color: '#78350F', lineHeight: 16 },

  // Blockchain
  blockchainCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 12,
  },
  blockchainTitle: { fontSize: 14, fontWeight: '700', color: '#1E40AF', marginBottom: 6 },
  blockchainMeta: { fontSize: 12, color: '#1E3A8A', marginBottom: 2 },

  anchorBtn: {
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  anchorBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  pdfBtn: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  pdfBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  btnDisabled: { opacity: 0.6 },

  disclaimer: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 32,
  },

  // Generate form
  formBody: { padding: 20 },
  formLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fff',
  },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  countrySelectorText: { fontSize: 15, color: '#111827' },
  countrySelectorPlaceholder: { fontSize: 15, color: '#9CA3AF' },
  chevron: { fontSize: 18, color: '#9CA3AF' },

  generateBtn: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  generateBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Country picker modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '75%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  pickerClose: { fontSize: 20, color: '#6B7280' },
  pickerSearch: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    marginBottom: 10,
  },
  countryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  countryItemActive: { backgroundColor: '#F0FDF4' },
  countryItemText: { fontSize: 15, color: '#111827' },
  countryItemTextActive: { color: '#065F46', fontWeight: '600' },
  countryCode: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },

  // Cache banners
  outdatedBanner: {
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  outdatedBannerText: { fontSize: 13, color: '#92400E', fontWeight: '500' },
  staleBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  staleBannerText: { fontSize: 13, color: '#991B1B', fontWeight: '500' },
  lastUpdatedText: { fontSize: 11, color: '#9CA3AF', marginBottom: 8 },
});

export default TravelCertificateScreen;
