import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  clearDraft,
  createNote,
  loadDraft,
  saveDraftLocally,
  type ClinicalNoteAccessControl,
  type ClinicalNoteAttachment,
} from '../services/noteService';

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_SAVE_INTERVAL_MS = 10_000;

const COMMON_TEMPLATES = [
  {
    title: 'Routine Checkup',
    subjective: 'Routine wellness exam following last appointment.',
    objective: 'Heart rate normal, weight stable, coat looks healthy.',
    assessment: 'No acute concerns. Mild dental tartar observed.',
    plan: 'Continue current diet, schedule dental cleaning in 3 months.',
  },
  {
    title: 'Post-Vaccination',
    subjective: 'Owner reports mild lethargy and reduced appetite after vaccination.',
    objective: 'Temperature within normal range, injection site clean.',
    assessment: 'Expected post-vaccine reaction; not indicative of infection.',
    plan: 'Monitor for 48 hours, provide water, return if swelling or fever develops.',
  },
  {
    title: 'Skin Irritation',
    subjective: 'Localized scratching on left flank. Owner reports redness for 2 days.',
    objective: 'Mild erythema, no open lesions, skin is warm to the touch.',
    assessment: 'Suspected contact dermatitis. No signs of systemic allergy.',
    plan: 'Apply topical emollient, avoid new detergents, re-check in 7 days.',
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved';

interface ClinicalNotesScreenProps {
  petId?: string;
  vetId?: string;
  onBack?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const ClinicalNotesScreen: React.FC<ClinicalNotesScreenProps> = ({
  petId: initialPetId = '',
  vetId: initialVetId = '',
  onBack,
}) => {
  const [petId, setPetId] = useState(initialPetId);
  const [vetId, setVetId] = useState(initialVetId);
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [attachments, setAttachments] = useState<ClinicalNoteAttachment[]>([]);
  const [measurementLabel, setMeasurementLabel] = useState('');
  const [measurementValue, setMeasurementValue] = useState('');
  const [photoLabel, setPhotoLabel] = useState('');
  const [photoReference, setPhotoReference] = useState('');
  const [allowVetAccess, setAllowVetAccess] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const isDirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Hydrate draft on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!initialPetId.trim() || !initialVetId.trim()) return;
    loadDraft(initialPetId.trim(), initialVetId.trim())
      .then((draft) => {
        if (!draft) return;
        setSubjective(draft.subjective);
        setObjective(draft.objective);
        setAssessment(draft.assessment);
        setPlan(draft.plan);
      })
      .catch(() => {});
    // Run once on mount — intentionally omitting deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Auto-save every 10 s ────────────────────────────────────────────────
  const persistDraft = useCallback(async () => {
    const pid = petId.trim();
    const vid = vetId.trim();
    if (!pid || !vid || !isDirtyRef.current) return;
    setSaveStatus('saving');
    try {
      await saveDraftLocally({
        petId: pid,
        vetId: vid,
        subjective,
        objective,
        assessment,
        plan,
        savedAt: new Date().toISOString(),
      });
      isDirtyRef.current = false;
      setSaveStatus('saved');
    } catch {
      setSaveStatus('idle');
    }
  }, [assessment, objective, petId, plan, subjective, vetId]);

  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      void persistDraft();
    }, AUTO_SAVE_INTERVAL_MS);
    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [persistDraft]);

  const markDirty = useCallback(() => {
    isDirtyRef.current = true;
    setSaveStatus('idle');
  }, []);

  // ─── Template helper ─────────────────────────────────────────────────────
  const applyTemplate = (index: number) => {
    const t = COMMON_TEMPLATES[index];
    setSubjective(t.subjective);
    setObjective(t.objective);
    setAssessment(t.assessment);
    setPlan(t.plan);
    markDirty();
  };

  // ─── Attachment helpers ──────────────────────────────────────────────────
  const addMeasurement = () => {
    if (!measurementLabel.trim() || !measurementValue.trim()) {
      Alert.alert('Validation', 'Measurement label and value are required.');
      return;
    }
    setAttachments((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        type: 'measurement' as const,
        label: measurementLabel.trim(),
        value: measurementValue.trim(),
      },
    ]);
    setMeasurementLabel('');
    setMeasurementValue('');
    markDirty();
  };

  const addPhotoReference = () => {
    if (!photoLabel.trim() || !photoReference.trim()) {
      Alert.alert('Validation', 'Photo label and reference are required.');
      return;
    }
    setAttachments((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        type: 'photo' as const,
        label: photoLabel.trim(),
        value: photoReference.trim(),
      },
    ]);
    setPhotoLabel('');
    setPhotoReference('');
    markDirty();
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    markDirty();
  };

  // ─── Discard with confirmation ───────────────────────────────────────────
  const handleBack = () => {
    const hasDraft = subjective.trim() || objective.trim() || assessment.trim() || plan.trim();
    if (!hasDraft || !isDirtyRef.current) {
      onBack?.();
      return;
    }
    Alert.alert('Discard changes?', 'You have unsaved changes. Discard them and leave?', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          const pid = petId.trim();
          const vid = vetId.trim();
          if (pid && vid) await clearDraft(pid, vid).catch(() => {});
          onBack?.();
        },
      },
    ]);
  };

  // ─── Reset form ──────────────────────────────────────────────────────────
  const resetForm = () => {
    setSubjective('');
    setObjective('');
    setAssessment('');
    setPlan('');
    setAttachments([]);
    setAllowVetAccess(true);
    isDirtyRef.current = false;
    setSaveStatus('idle');
  };

  // ─── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const pid = petId.trim();
    const vid = vetId.trim();
    if (!vid || !pid) {
      Alert.alert('Validation', 'Vet ID and Pet ID are required.');
      return;
    }
    if (!subjective.trim() || !objective.trim() || !assessment.trim() || !plan.trim()) {
      Alert.alert('Validation', 'All four SOAP fields are required.');
      return;
    }
    setSubmitting(true);
    try {
      const accessControls: ClinicalNoteAccessControl[] = allowVetAccess
        ? [{ role: 'vet', entityId: vid || 'unassigned-vet', permission: 'read' }]
        : [];

      await createNote({
        vetId: vid,
        petId: pid,
        subjective: subjective.trim(),
        objective: objective.trim(),
        assessment: assessment.trim(),
        plan: plan.trim(),
        // Strip local-only `id` field before sending to API
        attachments: attachments.map(({ type, label, value }) => ({ type, label, value })),
        accessControls,
      });

      await clearDraft(pid, vid).catch(() => {});
      resetForm();
      Alert.alert('Success', 'Clinical note anchored to the blockchain.');
    } catch (error) {
      Alert.alert(
        'Submit failed',
        error instanceof Error ? error.message : 'An unexpected error occurred.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Draft indicator ─────────────────────────────────────────────────────
  const draftLabel =
    saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : null;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBack}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.headerBackText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Clinical Notes</Text>
        <Text style={styles.headerDraft}>{draftLabel ?? ''}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* IDs */}
        <Text style={styles.label}>Pet ID</Text>
        <TextInput
          style={styles.input}
          value={petId}
          placeholder="Pet ID"
          onChangeText={(v) => {
            setPetId(v);
            markDirty();
          }}
          autoCapitalize="none"
          editable={!initialPetId}
          accessibilityLabel="Pet ID"
        />

        <Text style={styles.label}>Vet ID</Text>
        <TextInput
          style={styles.input}
          value={vetId}
          placeholder="Vet ID"
          onChangeText={(v) => {
            setVetId(v);
            markDirty();
          }}
          autoCapitalize="none"
          accessibilityLabel="Vet ID"
        />

        {/* Templates */}
        <Text style={styles.sectionTitle}>Common Templates</Text>
        <View style={styles.templateRow}>
          {COMMON_TEMPLATES.map((template, index) => (
            <TouchableOpacity
              key={template.title}
              style={styles.templateButton}
              onPress={() => applyTemplate(index)}
              accessibilityRole="button"
              accessibilityLabel={`Apply ${template.title} template`}
            >
              <Text style={styles.templateButtonText}>{template.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── SOAP ── */}
        <Text style={styles.soapLabel}>S — Subjective</Text>
        <Text style={styles.soapHint}>Owner-reported history and presenting complaint</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={subjective}
          placeholder="What the owner observed or reports…"
          onChangeText={(v) => {
            setSubjective(v);
            markDirty();
          }}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Subjective"
        />

        <Text style={styles.soapLabel}>O — Objective</Text>
        <Text style={styles.soapHint}>Physical exam findings and measurable data</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={objective}
          placeholder="Vitals, exam findings, lab results…"
          onChangeText={(v) => {
            setObjective(v);
            markDirty();
          }}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Objective"
        />

        <Text style={styles.soapLabel}>A — Assessment</Text>
        <Text style={styles.soapHint}>Diagnosis or differential diagnoses</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={assessment}
          placeholder="Clinical impression and diagnosis…"
          onChangeText={(v) => {
            setAssessment(v);
            markDirty();
          }}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Assessment"
        />

        <Text style={styles.soapLabel}>P — Plan</Text>
        <Text style={styles.soapHint}>Treatment, medications, and follow-up</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={plan}
          placeholder="Treatment plan and next steps…"
          onChangeText={(v) => {
            setPlan(v);
            markDirty();
          }}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Plan"
        />

        {/* Attachments */}
        <Text style={styles.sectionTitle}>Attachments</Text>
        <View style={styles.attachmentRow}>
          <TextInput
            style={[styles.input, styles.attachmentInput]}
            value={measurementLabel}
            placeholder="Measurement label"
            onChangeText={setMeasurementLabel}
            accessibilityLabel="Measurement label"
          />
          <TextInput
            style={[styles.input, styles.attachmentInput]}
            value={measurementValue}
            placeholder="Value"
            onChangeText={setMeasurementValue}
            accessibilityLabel="Measurement value"
          />
          <TouchableOpacity
            style={styles.addButton}
            onPress={addMeasurement}
            accessibilityRole="button"
            accessibilityLabel="Add measurement"
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.attachmentRow}>
          <TextInput
            style={[styles.input, styles.attachmentInput]}
            value={photoLabel}
            placeholder="Photo label"
            onChangeText={setPhotoLabel}
            accessibilityLabel="Photo label"
          />
          <TextInput
            style={[styles.input, styles.attachmentInput]}
            value={photoReference}
            placeholder="Reference metadata"
            onChangeText={setPhotoReference}
            accessibilityLabel="Photo reference"
          />
          <TouchableOpacity
            style={styles.addButton}
            onPress={addPhotoReference}
            accessibilityRole="button"
            accessibilityLabel="Add photo reference"
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        {attachments.length > 0 && (
          <View style={styles.attachmentsList}>
            {attachments.map((a) => (
              <View key={a.id} style={styles.attachmentItem}>
                <View style={styles.attachmentItemContent}>
                  <Text style={styles.attachmentMeta}>{a.type.toUpperCase()}</Text>
                  <Text style={styles.attachmentText}>
                    {a.label} — {a.value}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => removeAttachment(a.id)}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${a.label}`}
                >
                  <Text style={styles.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Access Control */}
        <Text style={styles.sectionTitle}>Access Control</Text>
        <View style={styles.accessRow}>
          <Text style={styles.accessLabel}>Grant vet read access</Text>
          <Switch
            value={allowVetAccess}
            onValueChange={setAllowVetAccess}
            accessibilityLabel="Grant vet read access"
          />
        </View>

        {/* Submit */}
        <View style={styles.submitContainer}>
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Submit and anchor note"
          >
            <Text style={styles.submitButtonText}>
              {submitting ? 'Anchoring…' : 'Submit & Anchor Note'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  headerBack: { minWidth: 60 },
  headerBackText: { color: '#1f65ff', fontSize: 16 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  headerDraft: { minWidth: 60, textAlign: 'right', fontSize: 12, color: '#6b7280' },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    marginTop: 22,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  soapLabel: { marginTop: 20, marginBottom: 2, fontSize: 15, fontWeight: '700', color: '#1f65ff' },
  soapHint: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, color: '#374151' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
    color: '#111827',
  },
  multiline: { minHeight: 120 },
  templateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  templateButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#eef2ff',
    borderRadius: 10,
  },
  templateButtonText: { color: '#1f2937', fontWeight: '600', fontSize: 13 },
  attachmentRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  attachmentInput: { flex: 1, marginRight: 8, marginBottom: 0 },
  addButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#1f65ff',
  },
  addButtonText: { color: '#fff', fontWeight: '700' },
  attachmentsList: { marginBottom: 12 },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 10,
  },
  attachmentItemContent: { flex: 1 },
  attachmentMeta: { fontSize: 11, fontWeight: '700', color: '#6b7280', marginBottom: 2 },
  attachmentText: { fontSize: 14, color: '#374151' },
  removeText: { fontSize: 16, color: '#ef4444', paddingLeft: 8 },
  accessRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  accessLabel: { flex: 1, fontSize: 15, color: '#374151' },
  submitContainer: { marginTop: 28 },
  submitButton: {
    backgroundColor: '#1f65ff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: { backgroundColor: '#a5b4fc' },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

export default ClinicalNotesScreen;
