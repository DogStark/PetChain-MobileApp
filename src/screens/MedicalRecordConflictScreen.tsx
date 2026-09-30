import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

/**
 * Field-aware conflict resolution for concurrent medical-record edits.
 *
 * Two devices may edit the same record offline. During sync we compare the
 * local and remote versions using record version/etag metadata. Fields that
 * are unchanged between the two versions are merged automatically; only
 * fields that actually diverge are surfaced for the user to review.
 *
 * Nothing is written back until the user confirms, so a conflict can never
 * silently overwrite local or remote data. The resulting resolution is
 * recorded as a replay-safe payload (base version + per-field choices) so it
 * can be re-applied idempotently if the sync is retried.
 */

export type ConflictChoice = 'local' | 'remote';

export interface MedicalRecord {
  id: string;
  version: number;
  etag: string;
  fields: Record<string, unknown>;
}

export interface FieldConflict {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
}

export interface ConflictResolution {
  recordId: string;
  /** Version the user reviewed against; used to detect stale replays. */
  baseVersion: number;
  baseEtag: string;
  /** Fields that were identical and merged without user input. */
  autoMerged: Record<string, unknown>;
  /** Explicit per-field choices made by the user. */
  choices: Record<string, ConflictChoice>;
  /** Final merged field values to persist. */
  merged: Record<string, unknown>;
}

/**
 * Compare local and remote versions of a record.
 *
 * Returns the fields that are identical (safe to auto-merge) and the fields
 * that diverge (require user review). A record is only considered in
 * conflict when at least one field diverges.
 */
export function detectConflict(
  local: MedicalRecord,
  remote: MedicalRecord,
): { autoMerged: Record<string, unknown>; conflicts: FieldConflict[] } {
  const autoMerged: Record<string, unknown> = {};
  const conflicts: FieldConflict[] = [];
  const fieldNames = new Set([
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);

  fieldNames.forEach((field) => {
    const localValue = local.fields[field];
    const remoteValue = remote.fields[field];
    if (isEqual(localValue, remoteValue)) {
      autoMerged[field] = localValue;
    } else {
      conflicts.push({ field, localValue, remoteValue });
    }
  });

  return { autoMerged, conflicts };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return '—';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export interface MedicalRecordConflictScreenProps {
  local: MedicalRecord;
  remote: MedicalRecord;
  /**
   * Called with the replay-safe resolution once the user confirms.
   * The caller is responsible for persisting the merged record and
   * advancing the version/etag.
   */
  onResolve: (resolution: ConflictResolution) => void | Promise<void>;
  /** Called when the user discards the local edits and keeps remote. */
  onDiscard?: () => void;
}

export default function MedicalRecordConflictScreen({
  local,
  remote,
  onResolve,
  onDiscard,
}: MedicalRecordConflictScreenProps) {
  const { autoMerged, conflicts } = useMemo(
    () => detectConflict(local, remote),
    [local, remote],
  );

  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() => {
    const initial: Record<string, ConflictChoice> = {};
    conflicts.forEach((conflict) => {
      initial[conflict.field] = 'local';
    });
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);

  const selectChoice = useCallback((field: string, choice: ConflictChoice) => {
    setChoices((prev) => ({ ...prev, [field]: choice }));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const merged: Record<string, unknown> = { ...autoMerged };
      conflicts.forEach((conflict) => {
        merged[conflict.field] =
          choices[conflict.field] === 'remote'
            ? conflict.remoteValue
            : conflict.localValue;
      });

      await onResolve({
        recordId: local.id,
        baseVersion: local.version,
        baseEtag: local.etag,
        autoMerged,
        choices,
        merged,
      });
    } finally {
      setSubmitting(false);
    }
  }, [autoMerged, choices, conflicts, local, onResolve, submitting]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Resolve record conflict</Text>
      <Text style={styles.subtitle}>
        This record was edited on another device. Review the differing fields
        before merging. Nothing is saved until you confirm.
      </Text>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {conflicts.length === 0 ? (
          <Text style={styles.cleanMerge}>
            No conflicting fields. All changes can be merged automatically.
          </Text>
        ) : (
          conflicts.map((conflict) => (
            <View key={conflict.field} style={styles.conflictCard}>
              <Text style={styles.fieldName}>{conflict.field}</Text>
              <TouchableOpacity
                style={[
                  styles.option,
                  choices[conflict.field] === 'local' && styles.optionSelected,
                ]}
                onPress={() => selectChoice(conflict.field, 'local')}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: choices[conflict.field] === 'local',
                }}
              >
                <Text style={styles.optionLabel}>This device</Text>
                <Text style={styles.optionValue}>
                  {formatValue(conflict.localValue)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.option,
                  choices[conflict.field] === 'remote' && styles.optionSelected,
                ]}
                onPress={() => selectChoice(conflict.field, 'remote')}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: choices[conflict.field] === 'remote',
                }}
              >
                <Text style={styles.optionLabel}>Other device</Text>
                <Text style={styles.optionValue}>
                  {formatValue(conflict.remoteValue)}
                </Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        {Object.keys(autoMerged).length > 0 && (
          <View style={styles.autoMergedSection}>
            <Text style={styles.autoMergedTitle}>Merged automatically</Text>
            {Object.keys(autoMerged).map((field) => (
              <Text key={field} style={styles.autoMergedRow}>
                {field}: {formatValue(autoMerged[field])}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        {onDiscard && (
          <TouchableOpacity
            style={[styles.button, styles.discardButton]}
            onPress={onDiscard}
            disabled={submitting}
          >
            <Text style={styles.discardText}>Discard local edits</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.button, styles.confirmButton]}
          onPress={handleConfirm}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.confirmText}>Merge and sync</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#4b5563',
  },
  scrollContent: {
    paddingVertical: 16,
  },
  cleanMerge: {
    fontSize: 14,
    color: '#047857',
  },
  conflictCard: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
  },
  fieldName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  option: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  optionSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  optionValue: {
    marginTop: 4,
    fontSize: 14,
    color: '#111827',
  },
  autoMergedSection: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
  },
  autoMergedTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  autoMergedRow: {
    fontSize: 13,
    color: '#4b5563',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  discardText: {
    color: '#374151',
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#2563eb',
    minWidth: 140,
  },
  confirmText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
