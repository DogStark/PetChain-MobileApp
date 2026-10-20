import React, { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  checkAccess,
  clearLocalHandovers,
  loadHandovers,
  recordHandover,
  syncHandovers,
  type FosterHandoverDraft,
  type FosterHandoverRecord,
  type FosterHandoverSyncResult,
} from '../services/fosterHandoverService';

// ─── Constants ────────────────────────────────────────────────────────────────

type ScreenStatus = 'loading' | 'ready' | 'denied' | 'error';

type DetailField = Exclude<keyof FosterHandoverDraft, 'handedOverAt'>;

const DETAIL_FIELDS: Array<{ key: DetailField; label: string; hint: string }> = [
  { key: 'food', label: 'Food', hint: 'Feeding times, amounts, and any changes' },
  { key: 'medications', label: 'Medications', hint: 'Doses given and doses still due' },
  { key: 'behavior', label: 'Behavior', hint: 'Mood, appetite, toileting, and anything unusual' },
  {
    key: 'nextAppointment',
    label: 'Next appointment',
    hint: 'Date, time, and clinic for the next visit',
  },
];

const OFFLINE_NOTICE =
  "You're offline. Showing saved handovers; new entries will sync when you're back online.";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Current local time formatted as "YYYY-MM-DD HH:mm" for the date field. */
function localNowInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16).replace('T', ' ');
}

function emptyDraft(): FosterHandoverDraft {
  return {
    handedOverAt: localNowInputValue(),
    food: '',
    medications: '',
    behavior: '',
    nextAppointment: '',
  };
}

function formatWhen(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

function noticeFor(result: FosterHandoverSyncResult): string | null {
  if (result.writeDenied) {
    return "You no longer have permission to add handovers. Your unsent entry was discarded.";
  }
  if (!result.reachable) return OFFLINE_NOTICE;
  if (result.pendingCount > 0) {
    return `${result.pendingCount} ${result.pendingCount === 1 ? 'entry is' : 'entries are'} waiting to sync.`;
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface FosterHandoverScreenProps {
  petId: string;
  petName?: string;
}

const FosterHandoverScreen: React.FC<FosterHandoverScreenProps> = ({ petId, petName }) => {
  const subject = petName ?? 'this pet';
  const [status, setStatus] = useState<ScreenStatus>('loading');
  const [canWrite, setCanWrite] = useState(false);
  const [records, setRecords] = useState<FosterHandoverRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<FosterHandoverDraft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const applySync = useCallback((result: FosterHandoverSyncResult) => {
    setRecords(result.records);
    if (result.accessDenied) {
      setCanWrite(false);
      setStatus('denied');
      return;
    }
    if (result.writeDenied) setCanWrite(false);
    setNotice(noticeFor(result));
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setNotice(null);
    setFormError(null);
    try {
      const access = await checkAccess(petId);

      if (access.status === 'denied' || access.status === 'unauthenticated') {
        // Private by default: never show cached records to a user who lost access.
        await clearLocalHandovers(petId);
        setRecords([]);
        setCanWrite(false);
        setStatus('denied');
        return;
      }

      const saved = await loadHandovers(petId);
      setRecords(saved);

      if (access.status === 'error') {
        // Access could not be confirmed; show the saved copy read-only.
        setCanWrite(false);
        setNotice('Could not confirm your access right now. Showing the saved copy.');
        setStatus('ready');
        return;
      }

      setCanWrite(access.canWrite);
      setStatus('ready');
      applySync(await syncHandovers(petId));
    } catch {
      setStatus('error');
    }
  }, [applySync, petId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = useCallback((key: keyof FosterHandoverDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const next = await recordHandover(petId, draft);
      setRecords(next);
      setDraft(emptyDraft());
      AccessibilityInfo.announceForAccessibility('Handover saved');
      applySync(await syncHandovers(petId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the handover.';
      setFormError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      setSubmitting(false);
    }
  }, [applySync, draft, petId, submitting]);

  if (status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Loading handover records" />
      </View>
    );
  }

  if (status === 'denied') {
    return (
      <View style={styles.centered}>
        <Text style={styles.message} accessibilityRole="alert">
          {`You don't have access to ${subject}'s handover records.`}
        </Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.message} accessibilityRole="alert">
          Handover records could not be loaded.
        </Text>
        <Pressable
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={styles.button}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {notice ? (
        <Text style={styles.notice} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      {canWrite ? (
        <View style={styles.form} accessibilityLabel="Record a handover">
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Record a handover
          </Text>

          <Text style={styles.label}>Handover date and time</Text>
          <TextInput
            style={styles.input}
            value={draft.handedOverAt}
            onChangeText={(value) => updateDraft('handedOverAt', value)}
            placeholder="YYYY-MM-DD HH:mm"
            placeholderTextColor="#8A8A8E"
            accessibilityLabel="Handover date and time"
            accessibilityHint="Format: year-month-day hour:minute"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {DETAIL_FIELDS.map((field) => (
            <View key={field.key}>
              <Text style={styles.label}>{field.label}</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={draft[field.key]}
                onChangeText={(value) => updateDraft(field.key, value)}
                placeholder={field.hint}
                placeholderTextColor="#8A8A8E"
                accessibilityLabel={field.label}
                accessibilityHint={field.hint}
                multiline
                maxLength={2000}
              />
            </View>
          ))}

          {formError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {formError}
            </Text>
          ) : null}

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Record handover"
            accessibilityState={{ disabled: submitting, busy: submitting }}
            style={[styles.button, submitting && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Record handover</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">
        Past handovers
      </Text>

      {records.length === 0 ? (
        <Text style={styles.message}>No handovers recorded yet.</Text>
      ) : (
        records.map((record) => (
          <View
            key={record.id}
            style={styles.record}
            accessible
            accessibilityLabel={`Handover on ${formatWhen(record.handedOverAt)}`}
          >
            <Text style={styles.recordTitle}>{formatWhen(record.handedOverAt)}</Text>
            <Text style={styles.recordMeta}>
              {record.syncStatus === 'pending'
                ? 'Pending sync'
                : `Recorded by ${record.recordedBy ?? 'a care partner'}`}
            </Text>
            {DETAIL_FIELDS.filter((field) => record[field.key].trim().length > 0).map((field) => (
              <Text key={field.key} style={styles.recordBody}>
                {`${field.label}: ${record[field.key]}`}
              </Text>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  message: {
    fontSize: 16,
    color: '#3C3C43',
    textAlign: 'center',
  },
  notice: {
    fontSize: 14,
    color: '#8A5A00',
    backgroundColor: '#FFF4D6',
    padding: 12,
    borderRadius: 8,
  },
  error: {
    fontSize: 14,
    color: '#B00020',
  },
  form: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    marginTop: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3C3C43',
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1C1C1E',
    backgroundColor: '#FFFFFF',
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#0A6CFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  record: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    gap: 4,
  },
  recordTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  recordMeta: {
    fontSize: 13,
    color: '#8A8A8E',
  },
  recordBody: {
    fontSize: 15,
    color: '#1C1C1E',
  },
});

export default FosterHandoverScreen;
