import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { v4 as uuid } from 'uuid';

import { SkeletonCard } from '../components/SkeletonCard';
import { useMinimumLoadingTime } from '../hooks/useMinimumLoadingTime';
import type { Medication } from '../models/Medication';
import {
  AppointmentStatus,
  type Appointment,
  cancelAppointmentReminder,
  cancelAllAppointmentReminders,
  cancelAppointmentById,
  rescheduleAppointment,
  detectConflicts,
  getAppointments,
  getPast,
  getUpcoming,
  saveAppointment,
  scheduleAppointmentReminders,
  type ConflictDetectionResult,
} from '../services/appointmentService';
import {
  syncAppointmentToCalendar,
  removeAppointmentFromCalendar,
} from '../services/calendarSyncService';
import { getMedications } from '../services/medicationService';
import { formatLocalDate, formatLocalTime } from '../utils/dateLocale';
import { useSecureScreen } from '../utils/secureScreen';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'upcoming' | 'past';

const EMPTY_FORM = {
  petId: '',
  petName: '',
  title: '',
  date: '',
  location: '',
  vetName: '',
  notes: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

const AppointmentScreen: React.FC = () => {
  useSecureScreen();

  const [tab, setTab] = useState<Tab>('upcoming');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bookingVisible, setBookingVisible] = useState(false);
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);
  const [rescheduleVisible, setRescheduleVisible] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [conflictState, setConflictState] = useState<ConflictCheckResponse | null>(null);

  // ── Conflict modal state ────────────────────────────────────────────────────
  const [conflictResult, setConflictResult] = useState<ConflictDetectionResult | null>(null);
  const [pendingAppointment, setPendingAppointment] = useState<Appointment | null>(null);
  const [conflictModalVisible, setConflictModalVisible] = useState(false);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);

  // Enforce minimum 300ms display for skeleton
  const displayLoading = useMinimumLoadingTime(isLoading, { minLoadingTime: 300 });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [appts, meds] = await Promise.all([getAppointments(), getMedications()]);
      setAppointments(appts);
      setMedications(meds);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const displayed = tab === 'upcoming' ? getUpcoming(appointments) : getPast(appointments);

  // ─── Build appointment object from form ──────────────────────────────────────

  const buildAppointment = (): Appointment | null => {
    if (!form.petName.trim() || !form.title.trim() || !form.date.trim()) {
      Alert.alert('Missing fields', 'Pet name, title and date are required.');
      return null;
    }
    const dateObj = new Date(form.date);
    if (isNaN(dateObj.getTime())) {
      Alert.alert('Invalid date', 'Use format YYYY-MM-DDTHH:MM (e.g. 2026-05-10T09:00)');
      return null;
    }
    return {
      id: uuid(),
      petId: form.petId.trim() || uuid(),
      vetId: 'temp-vet-id',
      petName: form.petName.trim(),
      title: form.title.trim(),
      date: dateObj.toISOString(),
      time: dateObj.toTimeString().slice(0, 5),
      type: 'ROUTINE_CHECKUP' as Appointment['type'],
      durationMinutes: 30,
      location: form.location.trim() || undefined,
      vetName: form.vetName.trim() || undefined,
      notes: form.notes.trim() || undefined,
      status: AppointmentStatus.PENDING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  // ─── Persist a confirmed appointment ─────────────────────────────────────────

  const persistAppointment = async (appt: Appointment, resolutionNote?: string) => {
    const saved = await saveAppointment(appt, resolutionNote);
    // Schedule 24h and 1h reminders
    await scheduleAppointmentReminders(saved).catch(() => {});
    // Sync to device calendar
    await syncAppointmentToCalendar(saved).catch(() => {});
    setForm(EMPTY_FORM);
    setConflictState(null);
    setBookingVisible(false);
    setConflictModalVisible(false);
    setPendingAppointment(null);
    setConflictResult(null);
    await load();
  };

  // ─── Book: validate → conflict check → persist ───────────────────────────────

  const handleBook = async () => {
    const appt = buildAppointment();
    if (!appt) return;

    setIsCheckingConflicts(true);
    try {
      const petMeds = medications.filter((m) => m.petId === appt.petId);
      const result = await detectConflicts(appt.petId, new Date(appt.date), petMeds);

      if (result.hasConflicts) {
        setPendingAppointment(appt);
        setConflictResult(result);
        setConflictModalVisible(true);
      } else {
        await persistAppointment(appt);
      }
    } finally {
      setIsCheckingConflicts(false);
    }
  };

  // ─── Conflict modal actions ───────────────────────────────────────────────────

  /** User chooses to proceed despite conflicts */
  const handleProceedAnyway = async () => {
    if (!pendingAppointment) return;
    await persistAppointment(
      pendingAppointment,
      'User chose to proceed despite scheduling conflicts.',
    );
  };

  /** User accepts the suggested conflict-free slot */
  const handleUseSuggestedTime = async () => {
    if (!pendingAppointment || !conflictResult?.suggestedTime) return;
    const suggested = conflictResult.suggestedTime;
    const updated: Appointment = {
      ...pendingAppointment,
      date: suggested.toISOString(),
      time: suggested.toTimeString().slice(0, 5),
    };
    await persistAppointment(
      updated,
      `Rescheduled to conflict-free slot: ${suggested.toLocaleString()}.`,
    );
  };

  /** User dismisses modal to pick a different time manually */
  const handleCancelConflict = () => {
    setConflictModalVisible(false);
    setPendingAppointment(null);
    setConflictResult(null);
  };

  // ─── Cancel appointment ────────────────────────────────────────────────────

  const handleCancel = (appt: Appointment) => {
    Alert.alert('Cancel appointment', `Cancel "${appt.title}"?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel',
        style: 'destructive',
        onPress: async () => {
          await cancelAllAppointmentReminders(appt.id).catch(() => {});
          await cancelAppointmentById(appt.id).catch(() =>
            saveAppointment({ ...appt, status: AppointmentStatus.CANCELLED }),
          );
          await removeAppointmentFromCalendar(appt.id).catch(() => {});
          setDetailAppt(null);
          await load();
        },
      },
    ]);
  };

  // ─── Reschedule ──────────────────────────────────────────────────────────────

  const handleReschedule = async () => {
    if (!detailAppt) return;
    const dateObj = new Date(rescheduleDate);
    if (isNaN(dateObj.getTime())) {
      Alert.alert('Invalid date', 'Use format YYYY-MM-DDTHH:MM');
      return;
    }

    setIsCheckingConflicts(true);
    try {
      const petMeds = medications.filter((m) => m.petId === detailAppt.petId);
      const result = await detectConflicts(
        detailAppt.petId,
        dateObj,
        petMeds,
        detailAppt.id, // exclude self
      );

      if (result.hasConflicts) {
        // Build a provisional updated appointment and show conflict modal
        const provisional: Appointment = {
          ...detailAppt,
          date: dateObj.toISOString(),
          status: AppointmentStatus.PENDING,
          notificationId: undefined,
        };
        setPendingAppointment(provisional);
        setConflictResult(result);
        setRescheduleVisible(false);
        setConflictModalVisible(true);
      } else {
        await doReschedule(dateObj);
      }
    } finally {
      setIsCheckingConflicts(false);
    }
  };

  const doReschedule = async (dateObj: Date, resolutionNote?: string) => {
    if (!detailAppt) return;
    // Cancel old reminders and calendar event
    await cancelAllAppointmentReminders(detailAppt.id).catch(() => {});
    await removeAppointmentFromCalendar(detailAppt.id).catch(() => {});

    const date = dateObj.toISOString().slice(0, 10);
    const time = dateObj.toTimeString().slice(0, 5);

    const updated = await rescheduleAppointment(detailAppt.id, date, time).catch(async () => {
      // Offline fallback
      const fallback: Appointment = {
        ...detailAppt,
        date: dateObj.toISOString(),
        time,
        status: AppointmentStatus.RESCHEDULED,
        notificationId: undefined,
      };
      await saveAppointment(fallback, resolutionNote);
      return fallback;
    });

    // Schedule new reminders and sync calendar
    await scheduleAppointmentReminders(updated).catch(() => {});
    await syncAppointmentToCalendar(updated).catch(() => {});

    setRescheduleVisible(false);
    setConflictModalVisible(false);
    setPendingAppointment(null);
    setConflictResult(null);
    setDetailAppt(updated);
    await load();
  };

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: Appointment }) => (
      <TouchableOpacity style={styles.card} onPress={() => setDetailAppt(item)}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardSub}>{item.petName}</Text>
          {item.vetName ? <Text style={styles.cardMeta}>Dr. {item.vetName}</Text> : null}
          {item.location ? <Text style={styles.cardMeta}>📍 {item.location}</Text> : null}
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardDate}>{formatLocalDate(item.date)}</Text>
          <Text style={styles.cardTime}>{formatLocalTime(item.date)}</Text>
          <View
            style={[
              styles.badge,
              item.status === AppointmentStatus.CANCELLED && styles.badgeCancelled,
            ]}
          >
            <Text style={styles.badgeText}>{item.status}</Text>
          </View>
        </View>
      </TouchableOpacity>
    ),
    [],
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Appointments</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setBookingVisible(true)}>
          <Text style={styles.addBtnText}>+ Book</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['upcoming', 'past'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {displayLoading ? (
        <View style={styles.list}>
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonCard key={`skeleton-${index}`} />
          ))}
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={(a) => a.id}
          renderItem={renderItem}
          contentContainerStyle={displayed.length === 0 && styles.empty}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {tab === 'upcoming' ? 'No upcoming appointments.' : 'No past appointments.'}
            </Text>
          }
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
        />
      )}

      {/* ── Book Modal ── */}
      <Modal
        visible={bookingVisible}
        animationType="slide"
        onRequestClose={() => {
          setBookingVisible(false);
          setConflictState(null);
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Book Appointment</Text>
            <TouchableOpacity
              onPress={() => {
                setBookingVisible(false);
                setConflictState(null);
              }}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {(
              [
                { key: 'petName', label: 'Pet Name *', placeholder: 'Buddy' },
                { key: 'title', label: 'Title *', placeholder: 'Annual checkup' },
                { key: 'date', label: 'Date & Time *', placeholder: '2026-05-10T09:00' },
                { key: 'vetName', label: 'Vet Name', placeholder: 'Dr. Smith' },
                { key: 'location', label: 'Location', placeholder: 'City Vet Clinic' },
                { key: 'notes', label: 'Notes', placeholder: 'Bring vaccination records' },
              ] as { key: keyof typeof EMPTY_FORM; label: string; placeholder: string }[]
            ).map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.label}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key]}
                  onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor="#9CA3AF"
                  multiline={key === 'notes'}
                />
              </View>
            ))}
            <TouchableOpacity
              style={[styles.primaryBtn, isCheckingConflicts && styles.btnDisabled]}
              onPress={() => void handleBook()}
              disabled={isCheckingConflicts}
            >
              {isCheckingConflicts ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Confirm Booking</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Conflict Warning Modal ── */}
      <Modal
        visible={conflictModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelConflict}
      >
        <View style={styles.overlay}>
          <View style={styles.conflictCard}>
            {/* Icon + title */}
            <View style={styles.conflictHeader}>
              <Text style={styles.conflictIcon}>⚠️</Text>
              <Text style={styles.conflictTitle}>Scheduling Conflict</Text>
            </View>

            <Text style={styles.conflictSubtitle}>
              The selected time conflicts with the following:
            </Text>

            {/* Conflict list */}
            <ScrollView style={styles.conflictList} nestedScrollEnabled>
              {(conflictResult?.conflicts ?? []).map((c, i) => (
                <View key={i} style={styles.conflictItem}>
                  <Text style={styles.conflictBullet}>
                    {c.type === 'appointment' ? '📅' : '💊'}
                  </Text>
                  <Text style={styles.conflictDesc}>{c.description}</Text>
                </View>
              ))}
            </ScrollView>

            {/* Suggested time */}
            {conflictResult?.suggestedTime && (
              <View style={styles.suggestionBox}>
                <Text style={styles.suggestionLabel}>💡 Next available slot:</Text>
                <Text style={styles.suggestionTime}>
                  {conflictResult.suggestedTime.toLocaleString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}

            {/* Actions */}
            {conflictResult?.suggestedTime && (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => void handleUseSuggestedTime()}
              >
                <Text style={styles.primaryBtnText}>Use Suggested Time</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.warningBtn} onPress={() => void handleProceedAnyway()}>
              <Text style={styles.warningBtnText}>Proceed Anyway</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancelConflict}>
              <Text style={styles.secondaryBtnText}>Pick a Different Time</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Detail Modal ── */}
      {detailAppt && (
        <Modal visible animationType="slide" onRequestClose={() => setDetailAppt(null)}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Appointment Details</Text>
              <TouchableOpacity onPress={() => setDetailAppt(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <DetailRow label="Title" value={detailAppt.title ?? '—'} />
              <DetailRow label="Pet" value={detailAppt.petName ?? '—'} />
              <DetailRow label="Date" value={formatLocalDate(detailAppt.date)} />
              <DetailRow label="Time" value={formatLocalTime(detailAppt.date)} />
              {detailAppt.vetName && <DetailRow label="Vet" value={`Dr. ${detailAppt.vetName}`} />}
              {detailAppt.location && <DetailRow label="Location" value={detailAppt.location} />}
              {detailAppt.notes && <DetailRow label="Notes" value={detailAppt.notes} />}
              <DetailRow label="Status" value={detailAppt.status} />

              {detailAppt.status === AppointmentStatus.PENDING && (
                <>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => {
                      setRescheduleDate('');
                      setRescheduleVisible(true);
                    }}
                  >
                    <Text style={styles.primaryBtnText}>Reschedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dangerBtn}
                    onPress={() => handleCancel(detailAppt)}
                  >
                    <Text style={styles.dangerBtnText}>Cancel Appointment</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>

          {/* ── Reschedule sub-modal ── */}
          <Modal
            visible={rescheduleVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setRescheduleVisible(false)}
          >
            <View style={styles.overlay}>
              <View style={styles.overlayCard}>
                <Text style={styles.modalTitle}>Reschedule</Text>
                <Text style={styles.label}>New Date & Time</Text>
                <TextInput
                  style={styles.input}
                  value={rescheduleDate}
                  onChangeText={setRescheduleDate}
                  placeholder="2026-06-01T10:00"
                  placeholderTextColor="#9CA3AF"
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, isCheckingConflicts && styles.btnDisabled]}
                  onPress={() => void handleReschedule()}
                  disabled={isCheckingConflicts}
                >
                  {isCheckingConflicts ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Confirm</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => setRescheduleVisible(false)}
                >
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </Modal>
      )}
    </View>
  );
};

// ─── Detail row helper ────────────────────────────────────────────────────────

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  addBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#10B981' },
  tabText: { fontSize: 14, color: '#6B7280' },
  tabTextActive: { color: '#10B981', fontWeight: '600' },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLeft: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  cardMeta: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  cardRight: { alignItems: 'flex-end', justifyContent: 'space-between' },
  cardDate: { fontSize: 12, color: '#374151', fontWeight: '500' },
  cardTime: { fontSize: 12, color: '#6B7280' },
  badge: {
    backgroundColor: '#D1FAE5',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  badgeCancelled: { backgroundColor: '#FEE2E2' },
  badgeText: { fontSize: 11, color: '#065F46', fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyText: { color: '#9CA3AF', fontSize: 15 },
  // Modal
  modalContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalClose: { color: '#fff', fontSize: 20, fontWeight: '600' },
  modalBody: { padding: 20, paddingBottom: 40 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
    color: '#111827',
  },
  primaryBtn: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  primaryBtnDisabled: { backgroundColor: '#9CA3AF', opacity: 0.6 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  dangerBtnText: { color: '#EF4444', fontWeight: '600', fontSize: 15 },
  warningBtn: {
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  warningBtnText: { color: '#B45309', fontWeight: '600', fontSize: 15 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { color: '#6B7280', fontSize: 14 },
  // Warning banner
  warningBanner: { borderRadius: 10, padding: 14, marginBottom: 16 },
  warningBannerRed: { backgroundColor: '#FEE2E2', borderLeftWidth: 4, borderLeftColor: '#EF4444' },
  warningBannerYellow: {
    backgroundColor: '#FEF3C7',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  warningBannerTitle: { fontWeight: '700', fontSize: 14, marginBottom: 6 },
  warningBannerTitleRed: { color: '#991B1B' },
  warningBannerTitleYellow: { color: '#92400E' },
  warningBannerText: { fontSize: 13, color: '#6B7280', marginBottom: 8 },
  conflictDetail: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.1)' },
  conflictDetailLabel: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 },
  conflictDetailValue: { fontSize: 12, color: '#6B7280' },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  detailLabel: { width: 90, fontSize: 13, color: '#6B7280', fontWeight: '600' },
  detailValue: { flex: 1, fontSize: 14, color: '#111827' },
  // Reschedule / conflict overlays
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  overlayCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  // Conflict modal specifics
  conflictCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    maxHeight: '85%',
  },
  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  conflictIcon: { fontSize: 24 },
  conflictTitle: { fontSize: 18, fontWeight: '700', color: '#92400E' },
  conflictSubtitle: { fontSize: 13, color: '#6B7280', marginBottom: 12 },
  conflictList: { maxHeight: 160, marginBottom: 8 },
  conflictItem: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#FEF3C7',
  },
  conflictBullet: { fontSize: 16 },
  conflictDesc: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },
  suggestionBox: {
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  suggestionLabel: { fontSize: 12, color: '#065F46', fontWeight: '600', marginBottom: 4 },
  suggestionTime: { fontSize: 14, color: '#047857', fontWeight: '700' },
  list: { padding: 16 },
});

export default AppointmentScreen;
