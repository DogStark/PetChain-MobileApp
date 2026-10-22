import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import apiClient from '../services/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Thresholds {
  heart_rate_min: string;
  heart_rate_max: string;
  weight_min: string;
  weight_max: string;
  temperature_min: string;
  temperature_max: string;
  activity_min: string;
  activity_max: string;
}

const EMPTY: Thresholds = {
  heart_rate_min: '',
  heart_rate_max: '',
  weight_min: '',
  weight_max: '',
  temperature_min: '',
  temperature_max: '',
  activity_min: '',
  activity_max: '',
};

// Clinically reasonable ranges (matches backend validation)
const LIMITS = {
  heart_rate: { min: 20, max: 300 },
  weight: { min: 0.1, max: 200 },
  temperature: { min: 30, max: 45 },
  activity: { min: 0, max: 100000 },
};

interface Props {
  petId?: string;
  onBack?: () => void;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(form: Thresholds): string | null {
  const hr_min = parseFloat(form.heart_rate_min);
  const hr_max = parseFloat(form.heart_rate_max);
  const w_min = parseFloat(form.weight_min);
  const w_max = parseFloat(form.weight_max);
  const t_min = parseFloat(form.temperature_min);
  const t_max = parseFloat(form.temperature_max);
  const a_min = parseFloat(form.activity_min);
  const a_max = parseFloat(form.activity_max);

  if (form.heart_rate_min && form.heart_rate_max) {
    if (hr_min >= hr_max) return 'Heart rate min must be less than max.';
    if (hr_min < LIMITS.heart_rate.min || hr_max > LIMITS.heart_rate.max)
      return `Heart rate must be between ${LIMITS.heart_rate.min}–${LIMITS.heart_rate.max} bpm.`;
  }
  if (form.weight_min && form.weight_max) {
    if (w_min >= w_max) return 'Weight min must be less than max.';
    if (w_min < LIMITS.weight.min || w_max > LIMITS.weight.max)
      return `Weight must be between ${LIMITS.weight.min}–${LIMITS.weight.max} kg.`;
  }
  if (form.temperature_min && form.temperature_max) {
    if (t_min >= t_max) return 'Temperature min must be less than max.';
    if (t_min < LIMITS.temperature.min || t_max > LIMITS.temperature.max)
      return `Temperature must be between ${LIMITS.temperature.min}–${LIMITS.temperature.max} °C.`;
  }
  if (form.activity_min && form.activity_max) {
    if (a_min >= a_max) return 'Activity min must be less than max.';
    if (a_min < LIMITS.activity.min || a_max > LIMITS.activity.max)
      return `Activity must be between ${LIMITS.activity.min}–${LIMITS.activity.max} steps.`;
  }
  return null;
}

function toPayload(form: Thresholds) {
  const n = (v: string) => (v.trim() === '' ? undefined : parseFloat(v));
  return {
    heart_rate_min: n(form.heart_rate_min),
    heart_rate_max: n(form.heart_rate_max),
    weight_min: n(form.weight_min),
    weight_max: n(form.weight_max),
    temperature_min: n(form.temperature_min),
    temperature_max: n(form.temperature_max),
    activity_min: n(form.activity_min),
    activity_max: n(form.activity_max),
  };
}

// ─── Field row ────────────────────────────────────────────────────────────────

const FieldRow: React.FC<{
  label: string;
  minKey: keyof Thresholds;
  maxKey: keyof Thresholds;
  unit: string;
  form: Thresholds;
  onChange: (key: keyof Thresholds, val: string) => void;
}> = ({ label, minKey, maxKey, unit, form, onChange }) => (
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>
      {label} ({unit})
    </Text>
    <View style={styles.fieldRow}>
      <View style={styles.fieldHalf}>
        <Text style={styles.subLabel}>Min</Text>
        <TextInput
          style={styles.input}
          value={form[minKey]}
          onChangeText={(v) => onChange(minKey, v)}
          keyboardType="decimal-pad"
          placeholder="—"
          accessibilityLabel={`${label} minimum`}
        />
      </View>
      <View style={styles.fieldHalf}>
        <Text style={styles.subLabel}>Max</Text>
        <TextInput
          style={styles.input}
          value={form[maxKey]}
          onChangeText={(v) => onChange(maxKey, v)}
          keyboardType="decimal-pad"
          placeholder="—"
          accessibilityLabel={`${label} maximum`}
        />
      </View>
    </View>
  </View>
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function HealthThresholdsScreen({ petId, onBack }: Props) {
  const [form, setForm] = useState<Thresholds>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setField = useCallback((key: keyof Thresholds, val: string) => {
    setForm((f) => ({ ...f, [key]: val.replace(/[^0-9.]/g, '') }));
    setError('');
  }, []);

  // ── Load existing thresholds ────────────────────────────────────────────────
  useEffect(() => {
    if (!petId) return;
    setLoading(true);
    apiClient
      .get(`/thresholds/${petId}`)
      .then((res) => {
        const d = res.data;
        if (d) {
          setForm({
            heart_rate_min: d.heart_rate_min?.toString() ?? '',
            heart_rate_max: d.heart_rate_max?.toString() ?? '',
            weight_min: d.weight_min?.toString() ?? '',
            weight_max: d.weight_max?.toString() ?? '',
            temperature_min: d.temperature_min?.toString() ?? '',
            temperature_max: d.temperature_max?.toString() ?? '',
            activity_min: d.activity_min?.toString() ?? '',
            activity_max: d.activity_max?.toString() ?? '',
          });
        }
      })
      .catch(() => setError('Failed to load thresholds.'))
      .finally(() => setLoading(false));
  }, [petId]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiClient.put(`/thresholds/${petId}`, toPayload(form));
      Alert.alert('Saved', 'Health thresholds updated successfully.');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save thresholds.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!petId) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No pet selected</Text>
        <Text style={styles.emptyBody}>
          Select a pet from the pet list to configure health alert thresholds.
        </Text>
        {onBack && (
          <TouchableOpacity style={styles.button} onPress={onBack} accessibilityRole="button">
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backBtn}>‹ Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title} accessibilityRole="header">
          Health Thresholds
        </Text>
      </View>

      <Text style={styles.subtitle}>
        Set alert boundaries for your pet's health metrics. Leave fields empty to disable an alert.
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#2563eb" style={styles.loader} />
      ) : (
        <>
          <FieldRow
            label="Heart Rate"
            unit="bpm"
            minKey="heart_rate_min"
            maxKey="heart_rate_max"
            form={form}
            onChange={setField}
          />
          <FieldRow
            label="Weight"
            unit="kg"
            minKey="weight_min"
            maxKey="weight_max"
            form={form}
            onChange={setField}
          />
          <FieldRow
            label="Temperature"
            unit="°C"
            minKey="temperature_min"
            maxKey="temperature_max"
            form={form}
            onChange={setField}
          />
          <FieldRow
            label="Daily Activity"
            unit="steps"
            minKey="activity_min"
            maxKey="activity_max"
            form={form}
            onChange={setField}
          />

          {!!error && (
            <Text
              style={styles.error}
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              {error}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.button, saving && styles.buttonDisabled]}
            onPress={() => void handleSave()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save health thresholds"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Save Thresholds</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  emptyContainer: {
    flex: 1,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  emptyBody: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backBtn: { fontSize: 18, color: '#2563eb', fontWeight: '600', marginRight: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 24, lineHeight: 20 },
  loader: { marginTop: 40 },
  fieldGroup: { marginBottom: 20 },
  fieldLabel: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 8 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldHalf: { flex: 1 },
  subLabel: { fontSize: 12, color: '#9ca3af', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#f9fafb',
  },
  error: { color: '#dc2626', fontSize: 14, marginBottom: 16 },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { backgroundColor: '#93c5fd' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
