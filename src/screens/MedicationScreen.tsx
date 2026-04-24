import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppText from '../components/AppText';
import {
  type DoseLog,
  type Medication,
  deleteMedication,
  getDaySchedule,
  getDoseLogs,
  getMedications,
  logDose,
  saveMedication,
  scheduleRefillReminder,
} from '../services/medicationService';
import { scheduleMedicationReminder } from '../services/notificationService';
import { scale, scaleFont } from '../utils/scaling';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'list' | 'daily' | 'weekly';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EMPTY_FORM: Omit<Medication, 'id'> = {
  petId: '',
  name: '',
  dosage: '',
  frequency: 8,
  startDate: new Date().toISOString(),
  endDate: '',
  refillDate: '',
  instructions: '',
  prescriberInfo: { name: '', contact: '', clinic: '' },
  pharmacyInfo: { name: '', phone: '', address: '' },
  totalPills: undefined,
  remainingPills: undefined,
  notes: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function todayDates(): Date[] {
  return [new Date()];
}

function weekDates(): Date[] {
  const today = new Date();
  const day = today.getDay();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - day + i);
    return d;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

const MedicationScreen: React.FC = () => {
  const [tab, setTab] = useState<Tab>('list');
  const [medications, setMedications] = useState<Medication[]>([]);
  const [doseLogs, setDoseLogs] = useState<DoseLog[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [form, setForm] = useState<Omit<Medication, 'id'>>(EMPTY_FORM);

  const dosageRef = useRef<TextInput>(null);
  const freqRef = useRef<TextInput>(null);
  const petIdRef = useRef<TextInput>(null);
  const startRef = useRef<TextInput>(null);
  const endRef = useRef<TextInput>(null);
  const refillRef = useRef<TextInput>(null);
  const instrRef = useRef<TextInput>(null);
  const pNameRef = useRef<TextInput>(null);
  const pContRef = useRef<TextInput>(null);
  const pClinRef = useRef<TextInput>(null);
  const phNameRef = useRef<TextInput>(null);
  const phPhoneRef = useRef<TextInput>(null);
  const phAddrRef = useRef<TextInput>(null);
  const totalRef = useRef<TextInput>(null);
  const remRef = useRef<TextInput>(null);
  const notesRef = useRef<TextInput>(null);

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const [meds, logs] = await Promise.all([getMedications(), getDoseLogs()]);
    setMedications(meds);
    setDoseLogs(logs);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Modal helpers ──────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditingMed(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
  };

  const openEdit = (med: Medication) => {
    setEditingMed(med);
    setForm({ ...med });
    setModalVisible(true);
  };

  const closeModal = () => setModalVisible(false);

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.petId.trim() || !form.name.trim() || !form.dosage.trim()) {
      Alert.alert('Validation', 'Pet ID, name, and dosage are required.');
      return;
    }
    const med: Medication = {
      ...form,
      id: editingMed?.id ?? Date.now().toString(),
      frequency: Number(form.frequency) || 8,
      totalPills: form.totalPills ? Number(form.totalPills) : undefined,
      remainingPills: form.remainingPills ? Number(form.remainingPills) : undefined,
    };
    await saveMedication(med);
    await scheduleRefillReminder(med);
    await scheduleMedicationReminder(med);
    closeModal();
    void loadData();
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = (id: string) => {
    Alert.alert('Delete', 'Remove this medication?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMedication(id);
          void loadData();
        },
      },
    ]);
  };

  // ── Log dose ───────────────────────────────────────────────────────────────

  const handleLogDose = async (medicationId: string, skipped = false) => {
    const log: DoseLog = {
      id: Date.now().toString(),
      medicationId,
      takenAt: new Date().toISOString(),
      skipped,
    };
    await logDose(log);

    // Decrement remaining pills
    const med = medications.find((m) => m.id === medicationId);
    if (med?.remainingPills !== undefined && !skipped) {
      await saveMedication({ ...med, remainingPills: Math.max(0, med.remainingPills - 1) });
    }
    void loadData();
  };

  // ── Dose status helpers ────────────────────────────────────────────────────

  const isDoseTaken = (medicationId: string, scheduledTime: Date): boolean => {
    const windowMs = 30 * 60 * 1000; // ±30 min window
    return doseLogs.some(
      (l) =>
        l.medicationId === medicationId &&
        !l.skipped &&
        Math.abs(new Date(l.takenAt).getTime() - scheduledTime.getTime()) <= windowMs,
    );
  };

  // ─── Render: Medication List ───────────────────────────────────────────────

  const renderMedItem = ({ item }: { item: Medication }) => {
    const lowStock =
      item.remainingPills !== undefined &&
      item.totalPills !== undefined &&
      item.remainingPills <= item.totalPills * 0.2;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <AppText style={styles.medName}>{item.name}</AppText>
          <View style={styles.cardActions}>
            <TouchableOpacity onPress={() => openEdit(item)} style={styles.actionBtn}>
              <AppText style={styles.actionBtnText}>Edit</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item.id)}
              style={[styles.actionBtn, styles.deleteBtn]}
            >
              <AppText style={[styles.actionBtnText, styles.deleteBtnText]}>Delete</AppText>
            </TouchableOpacity>
          </View>
        </View>

        <AppText style={styles.medDetail}>
          {item.dosage} · every {item.frequency}h
        </AppText>
        <AppText style={styles.medDetail}>Started: {formatDate(item.startDate)}</AppText>

        <AppText style={styles.medDetail}>Pet ID: {item.petId}</AppText>
        {item.instructions ? (
          <AppText style={styles.medDetail}>Instructions: {item.instructions}</AppText>
        ) : null}
        {item.prescriberInfo?.name ? (
          <AppText style={styles.medDetail}>
            Prescriber: {item.prescriberInfo.name}
            {item.prescriberInfo.contact ? ` • ${item.prescriberInfo.contact}` : ''}
          </AppText>
        ) : null}
        {item.pharmacyInfo?.name ? (
          <AppText style={styles.medDetail}>
            Pharmacy: {item.pharmacyInfo.name}
            {item.pharmacyInfo.phone ? ` • ${item.pharmacyInfo.phone}` : ''}
          </AppText>
        ) : null}
        <AppText style={styles.medDetail}>Started: {formatDate(item.startDate)}</AppText>
        {item.endDate && (
          <AppText style={styles.medDetail}>Ends: {formatDate(item.endDate)}</AppText>
        )}
        {item.remainingPills !== undefined && (
          <AppText style={[styles.medDetail, lowStock && styles.lowStock]}>
            Pills remaining: {item.remainingPills}
            {lowStock ? ' ⚠ Low stock' : ''}
          </AppText>
        )}

        {item.refillDate && (
          <AppText style={styles.medDetail}>Refill by: {formatDate(item.refillDate)}</AppText>
        )}

        <View style={styles.doseActions}>
          <TouchableOpacity
            style={styles.logBtn}
            onPress={() => void handleLogDose(item.id, false)}
          >
            <AppText style={styles.logBtnText}>✓ Log Dose</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.logBtn, styles.skipBtn]}
            onPress={() => void handleLogDose(item.id, true)}
          >
            <AppText style={styles.logBtnText}>✗ Skip</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── Render: Schedule (daily or weekly) ───────────────────────────────────

  const renderSchedule = (dates: Date[]) => (
    <ScrollView style={styles.scheduleContainer}>
      {dates.map((date) => {
        const label =
          dates.length === 1
            ? 'Today'
            : `${DAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`;

        const slots = medications.flatMap((med) =>
          getDaySchedule(med, date).map((time) => ({ med, time })),
        );
        slots.sort((a, b) => a.time.getTime() - b.time.getTime());

        return (
          <View key={date.toDateString()} style={styles.dayBlock}>
            <AppText style={styles.dayLabel}>{label}</AppText>
            {slots.length === 0 ? (
              <AppText style={styles.emptyText}>No doses scheduled</AppText>
            ) : (
              slots.map(({ med, time }) => {
                const taken = isDoseTaken(med.id, time);
                return (
                  <View
                    key={`${med.id}-${time.toISOString()}`}
                    style={[styles.slotRow, taken && styles.slotTaken]}
                  >
                    <AppText style={styles.slotTime}>{formatTime(time)}</AppText>
                    <AppText style={styles.slotName}>
                      {med.name} · {med.dosage}
                    </AppText>
                    {taken && <AppText style={styles.takenBadge}>✓</AppText>}
                  </View>
                );
              })
            )}
          </View>
        );
      })}
    </ScrollView>
  );

  // ─── Render: Form Modal ────────────────────────────────────────────────────

  const renderModal = () => (
    <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <AppText style={styles.modalTitle}>
            {editingMed ? 'Edit Medication' : 'Add Medication'}
          </AppText>

          <TextInput
            style={styles.input}
            placeholder="Medication name *"
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            returnKeyType="next"
            onSubmitEditing={() => dosageRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={dosageRef}
            style={styles.input}
            placeholder="Dosage (e.g. 5mg) *"
            value={form.dosage}
            onChangeText={(v) => setForm((f) => ({ ...f, dosage: v }))}
            returnKeyType="next"
            onSubmitEditing={() => freqRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={freqRef}
            style={styles.input}
            placeholder="Frequency (hours between doses)"
            keyboardType="numeric"
            value={String(form.frequency)}
            onChangeText={(v) => setForm((f) => ({ ...f, frequency: Number(v) || 8 }))}
            returnKeyType="next"
            onSubmitEditing={() => petIdRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={petIdRef}
            style={styles.input}
            placeholder="Pet ID *"
            value={form.petId}
            onChangeText={(v) => setForm((f) => ({ ...f, petId: v }))}
            returnKeyType="next"
            onSubmitEditing={() => startRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={startRef}
            style={styles.input}
            placeholder="Start date (YYYY-MM-DD)"
            value={form.startDate.slice(0, 10)}
            onChangeText={(v) => setForm((f) => ({ ...f, startDate: new Date(v).toISOString() }))}
            returnKeyType="next"
            onSubmitEditing={() => endRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={endRef}
            style={styles.input}
            placeholder="End date (YYYY-MM-DD)"
            value={form.endDate?.slice(0, 10) ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({ ...f, endDate: v ? new Date(v).toISOString() : '' }))
            }
            returnKeyType="next"
            onSubmitEditing={() => refillRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={refillRef}
            style={styles.input}
            placeholder="Refill date (YYYY-MM-DD)"
            value={form.refillDate?.slice(0, 10) ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({ ...f, refillDate: v ? new Date(v).toISOString() : '' }))
            }
            returnKeyType="next"
            onSubmitEditing={() => instrRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={instrRef}
            style={[styles.input, styles.textArea]}
            placeholder="Instructions"
            multiline
            value={form.instructions ?? ''}
            onChangeText={(v) => setForm((f) => ({ ...f, instructions: v }))}
            returnKeyType="next"
            onSubmitEditing={() => pNameRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={pNameRef}
            style={styles.input}
            placeholder="Prescriber name"
            value={form.prescriberInfo?.name ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({
                ...f,
                prescriberInfo: { ...f.prescriberInfo, name: v },
              }))
            }
            returnKeyType="next"
            onSubmitEditing={() => pContRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={pContRef}
            style={styles.input}
            placeholder="Prescriber contact"
            value={form.prescriberInfo?.contact ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({
                ...f,
                prescriberInfo: { ...f.prescriberInfo, contact: v },
              }))
            }
            returnKeyType="next"
            onSubmitEditing={() => pClinRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={pClinRef}
            style={styles.input}
            placeholder="Prescriber clinic"
            value={form.prescriberInfo?.clinic ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({
                ...f,
                prescriberInfo: { ...f.prescriberInfo, clinic: v },
              }))
            }
            returnKeyType="next"
            onSubmitEditing={() => phNameRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={phNameRef}
            style={styles.input}
            placeholder="Pharmacy name"
            value={form.pharmacyInfo?.name ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({
                ...f,
                pharmacyInfo: { ...f.pharmacyInfo, name: v },
              }))
            }
            returnKeyType="next"
            onSubmitEditing={() => phPhoneRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={phPhoneRef}
            style={styles.input}
            placeholder="Pharmacy phone"
            value={form.pharmacyInfo?.phone ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({
                ...f,
                pharmacyInfo: { ...f.pharmacyInfo, phone: v },
              }))
            }
            returnKeyType="next"
            onSubmitEditing={() => phAddrRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={phAddrRef}
            style={styles.input}
            placeholder="Pharmacy address"
            value={form.pharmacyInfo?.address ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({
                ...f,
                pharmacyInfo: { ...f.pharmacyInfo, address: v },
              }))
            }
            returnKeyType="next"
            onSubmitEditing={() => totalRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={totalRef}
            style={styles.input}
            placeholder="Total pills"
            keyboardType="numeric"
            value={form.totalPills !== undefined ? String(form.totalPills) : ''}
            onChangeText={(v) => setForm((f) => ({ ...f, totalPills: v ? Number(v) : undefined }))}
            returnKeyType="next"
            onSubmitEditing={() => remRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={remRef}
            style={styles.input}
            placeholder="Remaining pills"
            keyboardType="numeric"
            value={form.remainingPills !== undefined ? String(form.remainingPills) : ''}
            onChangeText={(v) =>
              setForm((f) => ({ ...f, remainingPills: v ? Number(v) : undefined }))
            }
            returnKeyType="next"
            onSubmitEditing={() => notesRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={notesRef}
            style={[styles.input, styles.textArea]}
            placeholder="Notes"
            multiline
            value={form.notes ?? ''}
            onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
            returnKeyType="done"
            onSubmitEditing={() => void handleSave()}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <AppText style={styles.cancelBtnText}>Cancel</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => void handleSave()}>
              <AppText style={styles.saveBtnText}>Save</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ─── Main render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <AppText style={styles.headerTitle}>Medications</AppText>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <AppText style={styles.addBtnText}>+ Add</AppText>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['list', 'daily', 'weekly'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.activeTab]}
            onPress={() => setTab(t)}
          >
            <AppText style={[styles.tabText, tab === t && styles.activeTabText]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {tab === 'list' && (
        <FlatList
          data={medications}
          keyExtractor={(item) => item.id}
          renderItem={renderMedItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<AppText style={styles.emptyText}>No medications added yet.</AppText>}
        />
      )}
      {tab === 'daily' && renderSchedule(todayDates())}
      {tab === 'weekly' && renderSchedule(weekDates())}

      {renderModal()}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: { fontSize: scaleFont(20), fontWeight: '700', color: '#1a1a1a' },
  addBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: scale(14),
    paddingVertical: scale(8),
    borderRadius: scale(8),
  },
  addBtnText: { color: '#fff', fontWeight: '600' },

  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: { flex: 1, paddingVertical: scale(12), alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#4CAF50' },
  tabText: { color: '#666', fontSize: scaleFont(14) },
  activeTabText: { color: '#4CAF50', fontWeight: '600' },

  listContent: { padding: 12 },

  card: {
    backgroundColor: '#fff',
    borderRadius: scale(10),
    padding: scale(14),
    marginBottom: scale(10),
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: scale(4),
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  medName: { fontSize: scaleFont(16), fontWeight: '700', color: '#1a1a1a', flex: 1 },
  cardActions: { flexDirection: 'row', gap: scale(6) },
  actionBtn: {
    paddingHorizontal: scale(10),
    paddingVertical: scale(4),
    borderRadius: scale(6),
    backgroundColor: '#e8f5e9',
  },
  actionBtnText: { fontSize: scaleFont(12), color: '#4CAF50', fontWeight: '600' },
  deleteBtn: { backgroundColor: '#fdecea' },
  deleteBtnText: { color: '#e53935' },

  medDetail: { fontSize: scaleFont(13), color: '#555', marginTop: scale(2) },
  lowStock: { color: '#e65100', fontWeight: '600' },

  doseActions: { flexDirection: 'row', gap: scale(8), marginTop: scale(10) },
  logBtn: {
    flex: 1,
    backgroundColor: '#4CAF50',
    paddingVertical: scale(8),
    borderRadius: scale(8),
    alignItems: 'center',
  },
  skipBtn: { backgroundColor: '#9e9e9e' },
  logBtnText: { color: '#fff', fontWeight: '600', fontSize: scaleFont(13) },

  scheduleContainer: { flex: 1, padding: scale(12) },
  dayBlock: { marginBottom: scale(16) },
  dayLabel: { fontSize: scaleFont(15), fontWeight: '700', color: '#333', marginBottom: scale(6) },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: scale(8),
    padding: scale(10),
    marginBottom: scale(4),
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  slotTaken: { borderLeftColor: '#9e9e9e', opacity: 0.7 },
  slotTime: { fontSize: scaleFont(13), fontWeight: '600', color: '#333', width: scale(60) },
  slotName: { flex: 1, fontSize: scaleFont(13), color: '#555' },
  takenBadge: { fontSize: scaleFont(16), color: '#4CAF50' },

  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontSize: 14 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: scale(16),
    borderTopRightRadius: scale(16),
    padding: scale(20),
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: scaleFont(18),
    fontWeight: '700',
    marginBottom: scale(14),
    color: '#1a1a1a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: scale(8),
    paddingHorizontal: scale(12),
    paddingVertical: scale(10),
    marginBottom: scale(10),
    fontSize: scaleFont(14),
    backgroundColor: '#fafafa',
  },
  textArea: { height: scale(70), textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: scale(10), marginTop: scale(4) },
  cancelBtn: {
    flex: 1,
    paddingVertical: scale(12),
    borderRadius: scale(8),
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#666', fontWeight: '600' },
  saveBtn: {
    flex: 1,
    paddingVertical: scale(12),
    borderRadius: scale(8),
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '600' },
});

export default MedicationScreen;
