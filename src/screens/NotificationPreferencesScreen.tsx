import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import PermissionRationaleModal from '../components/PermissionRationaleModal';
import {
  getPreferences,
  savePreferences,
  sendAlertNotification,
  type NotificationPreferences,
} from '../services/notificationService';
import petService, { type Pet } from '../services/petService';

interface Props {
  onBack: () => void;
}

const NotificationPreferencesScreen: React.FC<Props> = ({ onBack }) => {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [notifPermissionDenied, setNotifPermissionDenied] = useState(false);

  useEffect(() => {
    void (async () => {
      const [loaded, petList] = await Promise.all([
        getPreferences(),
        petService.getAllPets().catch(() => [] as Pet[]),
      ]);
      setPrefs(loaded);
      setPets(petList);
    })();
  }, []);

  const update = useCallback(
    <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => {
      setPrefs((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  const requestNotificationPermission = async (): Promise<boolean> => {
    const permission = await Notifications.requestPermissionsAsync();
    return (permission as { granted?: boolean; status?: string }).granted === true;
  };

  const handleToggleMedicationReminders = async (value: boolean) => {
    if (value) {
      const permission = await Notifications.getPermissionsAsync();
      const status = permission as { granted?: boolean; status?: string; canAskAgain?: boolean };
      if (!status.granted) {
        setNotifPermissionDenied(status.canAskAgain === false || status.status === 'denied');
        setShowRationale(true);
        return;
      }
    }
    update('medicationReminders', value);
    if (value) {
      void sendAlertNotification(
        'Medication Reminders On',
        'You will receive medication reminders.',
      );
    }
  };

  const getPetOverride = (petId: string) =>
    prefs?.petOverrides?.find((o) => o.petId === petId) ?? { petId };

  const updatePetOverride = (
    petId: string,
    field: 'medicationReminders' | 'appointmentReminders' | 'vaccinationAlerts',
    value: boolean,
  ) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      const overrides = prev.petOverrides ? [...prev.petOverrides] : [];
      const idx = overrides.findIndex((o) => o.petId === petId);
      if (idx >= 0) {
        overrides[idx] = { ...overrides[idx], [field]: value };
      } else {
        overrides.push({ petId, [field]: value });
      }
      return { ...prev, petOverrides: overrides };
    });
  };

  const handleSave = async () => {
    if (!prefs) return;

    const startValid = /^\d{2}:\d{2}$/.test(prefs.quietHoursStart);
    const endValid = /^\d{2}:\d{2}$/.test(prefs.quietHoursEnd);
    if (prefs.quietHoursEnabled && (!startValid || !endValid)) {
      Alert.alert('Invalid Time', 'Quiet hours must be in HH:MM format (e.g. 22:00).');
      return;
    }

    setSaving(true);
    try {
      await savePreferences(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      Alert.alert('Error', 'Failed to save notification preferences.');
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  const SectionHeader = ({ title }: { title: string }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
  );

  const Row = ({
    label,
    value,
    onValueChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#ddd', true: '#4CAF50' }}
        thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
        disabled={disabled}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <PermissionRationaleModal
        visible={showRationale}
        permissionType="notifications"
        showSettings={notifPermissionDenied}
        onAllow={async () => {
          setShowRationale(false);
          const granted = await requestNotificationPermission();
          if (granted) {
            update('medicationReminders', true);
          } else {
            setNotifPermissionDenied(true);
            setShowRationale(true);
          }
        }}
        onDeny={() => setShowRationale(false)}
      />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notification Preferences</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── By Type ── */}
        <SectionHeader title="By Type" />
        <View style={styles.card}>
          <Row
            label="Medication Reminders"
            value={prefs.medicationReminders}
            onValueChange={(v) => void handleToggleMedicationReminders(v)}
          />
          <View style={styles.sep} />
          <Row
            label="Appointment Reminders"
            value={prefs.appointmentReminders}
            onValueChange={(v) => {
              update('appointmentReminders', v);
              if (v)
                void sendAlertNotification(
                  'Appointment Reminders On',
                  'You will receive appointment reminders.',
                );
            }}
          />
          <View style={styles.sep} />
          <Row
            label="Vaccination Alerts"
            value={prefs.vaccinationAlerts}
            onValueChange={(v) => {
              update('vaccinationAlerts', v);
              if (v)
                void sendAlertNotification(
                  'Vaccination Alerts On',
                  'You will receive vaccination alerts.',
                );
            }}
          />
          <View style={styles.sep} />
          <Row
            label="Marketing & Promotions"
            value={prefs.marketingNotifications}
            onValueChange={(v) => {
              update('marketingNotifications', v);
              if (v)
                void sendAlertNotification(
                  'Marketing Notifications On',
                  'You will receive offers and updates from PetChain.',
                );
            }}
          />
        </View>

        {/* ── Sound / Vibration ── */}
        <SectionHeader title="Sound & Vibration" />
        <View style={styles.card}>
          <Row
            label="Sound"
            value={prefs.soundEnabled}
            onValueChange={(v) => update('soundEnabled', v)}
          />
          <View style={styles.sep} />
          <Row
            label="Vibration"
            value={prefs.vibrationEnabled}
            onValueChange={(v) => update('vibrationEnabled', v)}
          />
          <View style={styles.sep} />
          <Row
            label="Badge Count"
            value={prefs.badgeEnabled}
            onValueChange={(v) => update('badgeEnabled', v)}
          />
        </View>

        {/* ── Quiet Hours ── */}
        <SectionHeader title="Quiet Hours" />
        <View style={styles.card}>
          <Row
            label="Enable Quiet Hours"
            value={prefs.quietHoursEnabled}
            onValueChange={(v) => update('quietHoursEnabled', v)}
          />
          {prefs.quietHoursEnabled && (
            <>
              <View style={styles.sep} />
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.timeLabel}>Start (HH:MM)</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={prefs.quietHoursStart}
                    onChangeText={(v) => update('quietHoursStart', v)}
                    placeholder="22:00"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    accessibilityLabel="Quiet hours start time"
                  />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.timeLabel}>End (HH:MM)</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={prefs.quietHoursEnd}
                    onChangeText={(v) => update('quietHoursEnd', v)}
                    placeholder="07:00"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    accessibilityLabel="Quiet hours end time"
                  />
                </View>
              </View>
              <Text style={styles.hint}>Notifications will be suppressed during quiet hours.</Text>
              <Text style={styles.urgentNote}>
                🚨 Urgent alerts (Emergency SOS, medication overdue by &gt;2 h) always bypass quiet
                hours.
              </Text>
            </>
          )}
        </View>

        {/* ── By Pet ── */}
        {pets.length > 0 && (
          <>
            <SectionHeader title="By Pet" />
            {pets.map((pet) => {
              const override = getPetOverride(pet.id);
              return (
                <View key={pet.id} style={styles.card}>
                  <Text style={styles.petName}>{pet.name}</Text>
                  <View style={styles.sep} />
                  <Row
                    label="Medication Reminders"
                    value={override.medicationReminders ?? prefs.medicationReminders}
                    onValueChange={(v) => updatePetOverride(pet.id, 'medicationReminders', v)}
                  />
                  <View style={styles.sep} />
                  <Row
                    label="Appointment Reminders"
                    value={override.appointmentReminders ?? prefs.appointmentReminders}
                    onValueChange={(v) => updatePetOverride(pet.id, 'appointmentReminders', v)}
                  />
                  <View style={styles.sep} />
                  <Row
                    label="Vaccination Alerts"
                    value={override.vaccinationAlerts ?? prefs.vaccinationAlerts}
                    onValueChange={(v) => updatePetOverride(pet.id, 'vaccinationAlerts', v)}
                  />
                </View>
              );
            })}
          </>
        )}

        {saved && (
          <Text style={styles.successText} accessibilityLiveRegion="polite">
            ✓ Preferences saved
          </Text>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={() => void handleSave()}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save notification preferences"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Preferences</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 12,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  content: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 15, color: '#1a1a1a' },
  sep: { height: 1, backgroundColor: '#f0f0f0' },
  petName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4CAF50',
    paddingTop: 12,
    paddingBottom: 4,
  },
  timeRow: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  timeField: { flex: 1 },
  timeLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  timeInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
  hint: { fontSize: 12, color: '#aaa', paddingBottom: 6 },
  urgentNote: { fontSize: 12, color: '#d32f2f', paddingBottom: 10, fontWeight: '500' },
  successText: {
    color: '#4CAF50',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
  saveBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

export default NotificationPreferencesScreen;
