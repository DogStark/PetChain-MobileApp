import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';

import type { RootStackParamList } from '../navigation/types';
import geofenceService from '../services/geofenceService';
import lostFoundService, {
  type LostFoundReport,
  type LostFoundType,
} from '../services/lostFoundService';
import mapService, { type Location } from '../services/mapService';
import petService, { type Pet } from '../services/petService';
import { EmptyState } from '../components/EmptyState';
import { pickImage } from '../utils/imageUtils';

const DEFAULT_RADIUS_KM = 25;

const EMPTY_FORM = {
  type: 'lost' as LostFoundType,
  title: '',
  description: '',
  species: '',
  breed: '',
  photoUrl: undefined as string | undefined,
};

const LostFoundScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [reports, setReports] = useState<LostFoundReport[]>([]);
  const [selectedTab, setSelectedTab] = useState<LostFoundType>('lost');
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [matches, setMatches] = useState<LostFoundReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<LostFoundReport | null>(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [scannedPet, setScannedPet] = useState<Pet | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const coords = location;
      const { reports: fetched } = await lostFoundService.getLostFoundReports({
        type: selectedTab,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        radiusKm: DEFAULT_RADIUS_KM,
      });
      setReports(fetched);
    } catch (err) {
      console.warn('[LostFound] Failed to load reports', err);
      Alert.alert('Unable to load reports', 'Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [location, selectedTab]);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      try {
        const current = await mapService.getCurrentLocation();
        if (!active) return;
        setLocation(current);
        await lostFoundService.updateMyLocation(current);
      } catch {
        if (active) {
          Alert.alert(
            'Location required',
            'Lost & Found matching works best when location permission is granted.',
          );
        }
      } finally {
        if (active) void loadReports();
      }
    };

    void initialize();
    return () => {
      active = false;
    };
  }, [loadReports]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleSubmitReport = async () => {
    if (!form.title.trim() || !form.species.trim()) {
      Alert.alert('Validation error', 'Title and species are required.');
      return;
    }
    if (!location) {
      Alert.alert('Location missing', 'Please allow location access to post a report.');
      return;
    }

    try {
      const created = await lostFoundService.createLostFoundReport({
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim(),
        species: form.species.trim(),
        breed: form.breed.trim() || undefined,
        photoUrl: form.photoUrl,
        location,
      });

      // Register a 5 km geofence alert when a pet is marked as lost
      if (form.type === 'lost') {
        await geofenceService.registerGeofenceAlert({
          reportId: created.id,
          petName: form.title.trim(),
          ownerId: created.ownerId,
          center: location,
          radiusKm: 5,
          createdAt: created.createdAt,
        });
      }

      // If a found report is filed, notify nearby lost-pet owners via backend
      if (form.type === 'found') {
        await geofenceService.notifyOwnersByFoundReport(created.id, location);
      }

      setCreateModalVisible(false);
      setForm(EMPTY_FORM);
      await loadReports();
    } catch (err) {
      console.warn('[LostFound] Create report error', err);
      Alert.alert('Unable to create report', 'Please try again again later.');
    }
  };

  const handleRenewGeofence = async (report: LostFoundReport) => {
    const renewed = await geofenceService.renewGeofenceAlert(report.id);
    if (renewed) {
      Alert.alert('Alert renewed', 'Your geofence alert has been renewed for another 30 days.');
    } else {
      // Re-register using current location
      if (location) {
        await geofenceService.registerGeofenceAlert({
          reportId: report.id,
          petName: report.title,
          ownerId: report.ownerId,
          center: location,
          radiusKm: 5,
          createdAt: new Date().toISOString(),
        });
        Alert.alert('Alert renewed', 'Geofence alert renewed for another 30 days.');
      }
    }
  };

  const handleViewMatches = async (report: LostFoundReport) => {
    try {
      const { reports: fetched } = await lostFoundService.getReportMatches(
        report.id,
        DEFAULT_RADIUS_KM,
      );
      setSelectedReport(report);
      setMatches(fetched);
      setMatchModalVisible(true);
    } catch (err) {
      console.warn('[LostFound] Match lookup failed', err);
      Alert.alert('Unable to load matches', 'Try again in a moment.');
    }
  };

  const handlePickPhoto = async () => {
    try {
      const image = await pickImage();
      if (image) {
        setForm((current) => ({ ...current, photoUrl: image.uri }));
      }
    } catch (error) {
      console.warn('[LostFound] Photo picker failed', error);
    }
  };

  const handleScanQr = async (data: string) => {
    try {
      const pet = await petService.getPetByQRCode(data);
      setScannedPet(pet);
      setQrModalVisible(false);
    } catch (error) {
      Alert.alert('Invalid QR Code', 'Unable to resolve this PetChain QR code.');
    }
  };

  const displayedReports = useMemo(() => reports, [reports]);

  const renderReport = ({ item }: { item: LostFoundReport }) => {
    const isExpiredSoon =
      item.type === 'lost' &&
      item.expiresAt &&
      Date.parse(item.expiresAt) - Date.now() < 3 * 24 * 60 * 60 * 1000;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <View style={styles.cardTagRow}>
            <Text style={styles.cardTag}>{item.type === 'lost' ? 'Lost' : 'Found'}</Text>
            {item.type === 'lost' && (
              <Text style={styles.geofenceTag}>📍 5 km alert</Text>
            )}
          </View>
        </View>
        <Text style={styles.cardMeta}>Species: {item.species}</Text>
        {item.breed ? <Text style={styles.cardMeta}>Breed: {item.breed}</Text> : null}
        <Text style={styles.cardDescription} numberOfLines={3}>
          {item.description}
        </Text>
        {item.photoUrl ? <Image source={{ uri: item.photoUrl }} style={styles.cardImage} /> : null}
        {isExpiredSoon ? (
          <View style={styles.expiryBanner}>
            <Text style={styles.expiryText}>⚠️ Geofence alert expiring soon</Text>
            <TouchableOpacity onPress={() => handleRenewGeofence(item)}>
              <Text style={styles.renewText}>Renew</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleViewMatches(item)}>
            <Text style={styles.actionButtonText}>View matches</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Lost & Found Network</Text>
        <TouchableOpacity style={styles.scanButton} onPress={() => setQrModalVisible(true)}>
          <Text style={styles.scanButtonText}>Scan PetChain QR</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.filterRow}>
        {(['lost', 'found'] as LostFoundType[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabButton, selectedTab === tab && styles.tabButtonActive]}
            onPress={() => setSelectedTab(tab)}
          >
            <Text style={[styles.tabButtonText, selectedTab === tab && styles.tabButtonTextActive]}>
              {tab === 'lost' ? 'Lost Pets' : 'Found Pets'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.reportSummary}>
        <Text style={styles.summaryText}>{displayedReports.length} reports nearby</Text>
        <TouchableOpacity
          style={styles.newReportButton}
          onPress={() => setCreateModalVisible(true)}
        >
          <Text style={styles.newReportButtonText}>New report</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayedReports}
        renderItem={renderReport}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <Text style={styles.emptyText}>Loading reports…</Text>
          ) : (
            <EmptyState
              icon="search"
              title={selectedTab === 'lost' ? 'No Lost Pets Nearby' : 'No Found Pets Nearby'}
              description={selectedTab === 'lost' ? 'No active lost pet reports in your area.' : 'No active found pet reports in your area.'}
              buttonText="Create a report"
              onPress={() => setCreateModalVisible(true)}
            />
          )
        }
        contentContainerStyle={styles.listContent}
      />

      <Modal visible={createModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create a report</Text>
            <View style={styles.typeSwitchRow}>
              {(['lost', 'found'] as LostFoundType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeSwitch, form.type === type && styles.typeSwitchActive]}
                  onPress={() => setForm((prev) => ({ ...prev, type }))}
                >
                  <Text
                    style={form.type === type ? styles.typeSwitchTextActive : styles.typeSwitchText}
                  >
                    {type === 'lost' ? 'Lost' : 'Found'} pet
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Title"
              value={form.title}
              onChangeText={(value) => setForm((prev) => ({ ...prev, title: value }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Species"
              value={form.species}
              onChangeText={(value) => setForm((prev) => ({ ...prev, species: value }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Breed (optional)"
              value={form.breed}
              onChangeText={(value) => setForm((prev) => ({ ...prev, breed: value }))}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Description"
              value={form.description}
              onChangeText={(value) => setForm((prev) => ({ ...prev, description: value }))}
              multiline
              numberOfLines={3}
            />
            <TouchableOpacity style={styles.photoButton} onPress={handlePickPhoto}>
              <Text style={styles.photoButtonText}>Add photo</Text>
            </TouchableOpacity>
            {form.photoUrl ? (
              <Image source={{ uri: form.photoUrl }} style={styles.uploadPreview} />
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setCreateModalVisible(false);
                  setForm(EMPTY_FORM);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitButton} onPress={handleSubmitReport}>
                <Text style={styles.submitButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={matchModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <Text style={styles.modalTitle}>Matches for {selectedReport?.title}</Text>
            <FlatList
              data={matches}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMeta}>Species: {item.species}</Text>
                  <Text style={styles.cardDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No matches found yet.</Text>}
            />
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setMatchModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={qrModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <Text style={styles.modalTitle}>Scan PetChain QR</Text>
            <Text style={styles.helpText}>Use the app's QR scanner to locate a pet profile.</Text>
            <TouchableOpacity
              style={styles.scanActionButton}
              onPress={() => {
                navigation.navigate('QRScanner', { onScanSuccess: handleScanQr });
                setQrModalVisible(false);
              }}
            >
              <Text style={styles.scanActionText}>Open scanner</Text>
            </TouchableOpacity>
            {scannedPet ? (
              <View style={styles.profileCard}>
                <Text style={styles.cardTitle}>{scannedPet.name}</Text>
                <Text style={styles.cardMeta}>{scannedPet.species}</Text>
                <Text style={styles.cardMeta}>{scannedPet.breed ?? 'Breed unknown'}</Text>
              </View>
            ) : null}
            <TouchableOpacity style={styles.closeButton} onPress={() => setQrModalVisible(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f7', paddingHorizontal: 14 },
  cardTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  geofenceTag: { color: '#16a34a', fontSize: 11, fontWeight: '700' },
  expiryBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fef9c3',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  expiryText: { color: '#854d0e', fontSize: 12, fontWeight: '600' },
  renewText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' },
  topBar: {
    marginTop: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  screenTitle: { fontSize: 22, fontWeight: '700' },
  scanButton: {
    backgroundColor: '#1f2937',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  scanButtonText: { color: '#fff', fontWeight: '600' },
  filterRow: { flexDirection: 'row', marginBottom: 14 },
  tabButton: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 12,
    marginRight: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  tabButtonActive: { backgroundColor: '#111827', borderColor: '#111827' },
  tabButtonText: { color: '#374151', fontWeight: '600' },
  tabButtonTextActive: { color: '#fff' },
  reportSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryText: { color: '#4b5563', fontSize: 14 },
  newReportButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  newReportButtonText: { color: '#fff', fontWeight: '600' },
  listContent: { paddingBottom: 32 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardTag: { color: '#2563eb', fontWeight: '700' },
  cardMeta: { color: '#4b5563', marginBottom: 4 },
  cardDescription: { color: '#374151', marginBottom: 8 },
  cardImage: { width: '100%', height: 160, borderRadius: 12, marginTop: 8 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  actionButton: {
    backgroundColor: '#e0e7ff',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  actionButtonText: { color: '#1d4ed8', fontWeight: '600' },
  emptyText: { marginTop: 24, textAlign: 'center', color: '#6b7280' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, padding: 18 },
  modalContentLarge: { backgroundColor: '#fff', borderRadius: 20, padding: 18, maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  typeSwitchRow: { flexDirection: 'row', marginBottom: 12 },
  typeSwitch: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    marginRight: 8,
    alignItems: 'center',
  },
  typeSwitchActive: { backgroundColor: '#111827', borderColor: '#111827' },
  typeSwitchText: { color: '#374151', fontWeight: '600' },
  typeSwitchTextActive: { color: '#fff', fontWeight: '600' },
  input: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 10,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  photoButton: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  photoButtonText: { color: '#111827', fontWeight: '600' },
  uploadPreview: { width: '100%', height: 140, borderRadius: 12, marginBottom: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  cancelButton: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  cancelButtonText: { color: '#374151', fontWeight: '700' },
  submitButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  closeButton: {
    marginTop: 12,
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeButtonText: { color: '#fff', fontWeight: '700' },
  helpText: { color: '#6b7280', marginBottom: 14 },
  scanActionButton: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  scanActionText: { color: '#fff', fontWeight: '700' },
  profileCard: { backgroundColor: '#f8fafc', borderRadius: 16, padding: 16, marginBottom: 16 },
});

export default LostFoundScreen;
