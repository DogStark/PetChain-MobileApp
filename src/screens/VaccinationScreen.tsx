import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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

import {
  cancelEntityNotification,
  scheduleVaccinationReminder,
} from '../services/notificationService';
import {
  anchorCertificateToStellar,
  generateVaccinationCertificate,
  shareCertificate,
  type PetCertificateInfo,
} from '../services/pdfService';
import {
  type VaccinationReminder,
  getVaccinationReminders,
  markVaccinationAdministered,
} from '../services/vaccinationService';
import { formatLocalDate } from '../utils/dateLocale';
import { useSecureScreen } from '../utils/secureScreen';

const STATUS_LABELS: Record<VaccinationReminder['status'], string> = {
  administered: 'Administered',
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
};

interface VaccinationScreenProps {
  petId?: string;
}

const VaccinationScreen: React.FC<VaccinationScreenProps> = ({ petId: initialPetId }) => {
  useSecureScreen();

  const [petId, setPetId] = useState(initialPetId ?? '');
  const [reminders, setReminders] = useState<VaccinationReminder[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Record vaccination modal ──────────────────────────────────────────────
  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<VaccinationReminder | null>(null);
  const [administeredDate, setAdministeredDate] = useState(new Date().toISOString().slice(0, 10));
  const [lotNumber, setLotNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');

  // ── Detail / reminder management modal ───────────────────────────────────
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailItem, setDetailItem] = useState<VaccinationReminder | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduling, setRescheduling] = useState(false);

  const sortedReminders = useMemo(
    () => [...reminders].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [reminders],
  );

  // ─── Schedule notifications for 7-day and 1-day lead times ───────────────
  const scheduleRemindersForVaccination = useCallback(
    async (reminder: VaccinationReminder): Promise<void> => {
      await scheduleVaccinationReminder({
        id: reminder.id,
        name: reminder.vaccineName,
        dueDate: reminder.dueDate,
        petId: reminder.petId,
      });
    },
    [],
  );

  const loadReminders = useCallback(async () => {
    if (!petId.trim()) return;
    setLoading(true);
    try {
      const nextReminders = await getVaccinationReminders(petId.trim());
      setReminders(nextReminders);
      // Schedule local push notifications (7-day + 1-day lead, handled inside scheduleVaccinationReminder)
      await Promise.all(nextReminders.map(scheduleRemindersForVaccination));
    } catch (error) {
      Alert.alert(
        'Vaccinations',
        error instanceof Error ? error.message : 'Unable to load reminders.',
      );
    } finally {
      setLoading(false);
    }
  }, [petId, scheduleRemindersForVaccination]);

  useEffect(() => {
    void loadReminders();
  }, [loadReminders]);

  // ─── Record administered ──────────────────────────────────────────────────
  const openAdministered = (reminder: VaccinationReminder) => {
    setSelected(reminder);
    setAdministeredDate(new Date().toISOString().slice(0, 10));
    setLotNumber('');
    setManufacturer('');
    setModalVisible(true);
  };

  const saveAdministered = async () => {
    if (!selected) return;
    try {
      await markVaccinationAdministered({
        petId: selected.petId,
        vaccineName: selected.vaccineName,
        administeredDate,
        lotNumber,
        manufacturer,
        nextDueDate: selected.schedule.boosterIntervalMonths ? selected.dueDate : undefined,
        anchorToBlockchain: true,
      });
      setModalVisible(false);

      // Reload reminders — the backend recalculates nextDueDate from history.
      // After reload, scheduleRemindersForVaccination fires for each reminder,
      // including the freshly-computed next due date.
      await loadReminders();
    } catch (error) {
      Alert.alert(
        'Vaccinations',
        error instanceof Error ? error.message : 'Unable to save record.',
      );
    }
  };

  // ─── Detail view: dismiss or reschedule reminder ──────────────────────────
  const openDetail = (reminder: VaccinationReminder) => {
    setDetailItem(reminder);
    setRescheduleDate(reminder.dueDate);
    setRescheduling(false);
    setDetailVisible(true);
  };

  const dismissReminder = async () => {
    if (!detailItem) return;
    try {
      await cancelEntityNotification(detailItem.id);
      Alert.alert('Reminder dismissed', `Notifications for ${detailItem.vaccineName} have been cancelled.`);
      setDetailVisible(false);
    } catch {
      Alert.alert('Error', 'Could not dismiss the reminder.');
    }
  };

  const rescheduleReminder = async () => {
    if (!detailItem) return;
    const parsed = new Date(rescheduleDate);
    if (isNaN(parsed.getTime()) || parsed <= new Date()) {
      Alert.alert('Invalid date', 'Please enter a future date in YYYY-MM-DD format.');
      return;
    }
    setRescheduling(true);
    try {
      // Cancel existing notifications then schedule fresh ones against the new due date
      await cancelEntityNotification(detailItem.id);
      await scheduleVaccinationReminder({
        id: detailItem.id,
        name: detailItem.vaccineName,
        dueDate: rescheduleDate,
        petId: detailItem.petId,
      });
      // Optimistically update the local state so the card reflects the new date
      setReminders((prev) =>
        prev.map((r) => (r.id === detailItem.id ? { ...r, dueDate: rescheduleDate } : r)),
      );
      Alert.alert('Rescheduled', `Reminders for ${detailItem.vaccineName} rescheduled to ${formatLocalDate(rescheduleDate)}.`);
      setDetailVisible(false);
    } catch {
      Alert.alert('Error', 'Could not reschedule the reminder.');
    } finally {
      setRescheduling(false);
    }
  };

  // ─── Certificate export ───────────────────────────────────────────────────
  const handleExportCertificate = async () => {
    if (!petId.trim()) {
      Alert.alert('Vaccinations', 'Enter a pet ID before exporting a certificate.');
      return;
    }
    try {
      const petInfo: PetCertificateInfo = {
        petId: petId.trim(),
        petName: petId.trim(),
        species: 'dog',
        ownerName: 'Pet Owner',
      };

      const cert = await generateVaccinationCertificate(petInfo, reminders);
      void anchorCertificateToStellar(cert.hash);

      Alert.alert(
        'Certificate Generated',
        `Certificate ID: ${cert.hash}\n\nWould you like to share it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Share', onPress: () => void shareCertificate(cert.filePath) },
        ],
      );
    } catch (error) {
      Alert.alert(
        'Vaccinations',
        error instanceof Error ? error.message : 'Unable to generate certificate.',
      );
    }
  };

  // ─── Render helpers ───────────────────────────────────────────────────────
  const renderNextDueDate = (item: VaccinationReminder) => {
    if (item.status === 'administered') return null;
    return (
      <Text style={styles.nextDue}>
        Next due: {formatLocalDate(item.dueDate)}
      </Text>
    );
  };

  const renderReminder = ({ item }: { item: VaccinationReminder }) => (
    <TouchableOpacity style={styles.card} onPress={() => openDetail(item)} activeOpacity={0.85}>
      <View style={styles.cardHeader}>
        <Text style={styles.vaccineName}>{item.vaccineName}</Text>
        <Text style={[styles.status, styles[item.status]]}>{STATUS_LABELS[item.status]}</Text>
      </View>
      <Text style={styles.detail}>Due: {formatLocalDate(item.dueDate)}</Text>
      {renderNextDueDate(item)}
      <Text style={styles.detail}>
        {item.schedule.core ? 'Core vaccine' : 'Risk-based vaccine'} ·{' '}
        {item.schedule.minimumAgeWeeks}+ weeks
      </Text>
      <Text style={styles.detail}>{item.schedule.notes}</Text>
      {item.lastAdministeredDate ? (
        <Text style={styles.detail}>
          Last administered: {formatLocalDate(item.lastAdministeredDate)}
        </Text>
      ) : null}
      {item.veterinaryVerification?.blockchainTxHash ? (
        <Text style={styles.verified}>Vet verified · Anchored on-chain</Text>
      ) : (
        <Text style={styles.pending}>Awaiting vet verification</Text>
      )}
      <Text style={styles.detail}>
        Reminders:{' '}
        {item.reminderDates.length
          ? item.reminderDates.map(formatLocalDate).join(', ')
          : 'none scheduled'}
      </Text>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={(e) => {
          e.stopPropagation();
          openAdministered(item);
        }}
      >
        <Text style={styles.primaryButtonText}>Mark administered</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vaccination Schedule</Text>
      <Text style={styles.subtitle}>
        Track age-specific dog and cat vaccines, reminder dates, and vet-verified blockchain
        records.
      </Text>
      <View style={styles.petSearchRow}>
        <TextInput
          value={petId}
          onChangeText={setPetId}
          placeholder="Pet ID"
          style={styles.petInput}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.secondaryButton} onPress={() => void loadReminders()}>
          <Text style={styles.secondaryButtonText}>{loading ? 'Loading…' : 'Load'}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.certificateButton}
        onPress={() => void handleExportCertificate()}
      >
        <Text style={styles.certificateButtonText}>Export certificate</Text>
      </TouchableOpacity>
      <FlatList
        data={sortedReminders}
        keyExtractor={(item) => item.id}
        renderItem={renderReminder}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Enter a pet ID to generate upcoming vaccination reminders.
          </Text>
        }
        contentContainerStyle={styles.listContent}
      />

      {/* ── Record vaccination modal ─────────────────────────────────────── */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>Record vaccination</Text>
            <Text style={styles.modalLabel}>{selected?.vaccineName}</Text>
            <TextInput
              value={administeredDate}
              onChangeText={setAdministeredDate}
              placeholder="Administered date (YYYY-MM-DD)"
              style={styles.input}
            />
            <TextInput
              value={manufacturer}
              onChangeText={setManufacturer}
              placeholder="Manufacturer"
              style={styles.input}
            />
            <TextInput
              value={lotNumber}
              onChangeText={setLotNumber}
              placeholder="Lot number"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => void saveAdministered()}
              >
                <Text style={styles.primaryButtonText}>Save & anchor</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Detail / reminder management modal ──────────────────────────── */}
      <Modal visible={detailVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>{detailItem?.vaccineName}</Text>

            {detailItem && (
              <>
                <Text style={styles.detailModalRow}>
                  Status: {STATUS_LABELS[detailItem.status]}
                </Text>
                <Text style={styles.detailModalRow}>
                  Due date: {formatLocalDate(detailItem.dueDate)}
                </Text>
                {detailItem.lastAdministeredDate ? (
                  <Text style={styles.detailModalRow}>
                    Last administered: {formatLocalDate(detailItem.lastAdministeredDate)}
                  </Text>
                ) : null}
                <Text style={styles.detailModalRow}>{detailItem.schedule.notes}</Text>
                {detailItem.reminderDates.length > 0 && (
                  <Text style={styles.detailModalRow}>
                    Scheduled reminders:{' '}
                    {detailItem.reminderDates.map(formatLocalDate).join(', ')}
                  </Text>
                )}

                <Text style={styles.sectionLabel}>Reschedule reminder</Text>
                <TextInput
                  value={rescheduleDate}
                  onChangeText={setRescheduleDate}
                  placeholder="New due date (YYYY-MM-DD)"
                  style={styles.input}
                />
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setDetailVisible(false)}
              >
                <Text style={styles.secondaryButtonText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dismissButton} onPress={() => void dismissReminder()}>
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, rescheduling && styles.buttonDisabled]}
                onPress={() => void rescheduleReminder()}
                disabled={rescheduling}
              >
                <Text style={styles.primaryButtonText}>
                  {rescheduling ? 'Saving…' : 'Reschedule'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#F7FAFC' },
  title: { fontSize: 24, fontWeight: '700', color: '#16324F', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#526171', marginBottom: 14 },
  petSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  petInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D8E0E8',
  },
  listContent: { paddingBottom: 32 },
  empty: { textAlign: 'center', color: '#667085', padding: 24 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E6ECF2',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  vaccineName: { fontSize: 18, fontWeight: '700', color: '#102A43' },
  status: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  administered: { color: '#0F5132', backgroundColor: '#D1E7DD' },
  overdue: { color: '#842029', backgroundColor: '#F8D7DA' },
  due_soon: { color: '#664D03', backgroundColor: '#FFF3CD' },
  upcoming: { color: '#084298', backgroundColor: '#CFE2FF' },
  detail: { color: '#344054', marginTop: 4 },
  nextDue: { color: '#1C7ED6', fontWeight: '600', marginTop: 4 },
  verified: { color: '#047857', fontWeight: '700', marginTop: 8 },
  pending: { color: '#B45309', fontWeight: '700', marginTop: 8 },
  primaryButton: {
    backgroundColor: '#1C7ED6',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    backgroundColor: '#E7F0FA',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#1C4E80', fontWeight: '700' },
  dismissButton: {
    backgroundColor: '#FEE2E2',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: { color: '#991B1B', fontWeight: '700' },
  certificateButton: {
    borderWidth: 1,
    borderColor: '#1C7ED6',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 14,
  },
  certificateButtonText: { color: '#1C7ED6', fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalLabel: { color: '#344054', marginBottom: 12 },
  detailModalRow: { color: '#344054', marginTop: 6, lineHeight: 20 },
  sectionLabel: { fontWeight: '700', color: '#102A43', marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 24,
    marginTop: 8,
    flexWrap: 'wrap',
  },
});

export default VaccinationScreen;
