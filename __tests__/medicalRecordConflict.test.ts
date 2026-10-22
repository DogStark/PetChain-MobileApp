/**
 * Sync fixtures for medical-record conflict resolution (#1075).
 *
 * Covers the four required scenarios:
 *   - clean merge (no overlapping edits)
 *   - conflict (overlapping edits on the same field)
 *   - retry (re-resolving after a failed push)
 *   - discard (user rejects the remote change)
 *
 * The fixtures are intentionally data-only so they can be consumed by the
 * mobile sync layer and by the field-aware review screen without pulling in
 * any platform-specific runtime.
 */

export type FieldValue = string | number | boolean | null;

export interface MedicalRecord {
  id: string;
  /** Monotonic record version used for optimistic concurrency. */
  version: number;
  /** Server-issued etag for the last known remote revision. */
  etag: string;
  fields: Record<string, FieldValue>;
}

export type ConflictResolution = 'local' | 'remote' | 'merged';

export interface FieldConflict {
  field: string;
  local: FieldValue;
  remote: FieldValue;
  base: FieldValue;
  resolution: ConflictResolution;
}

export interface MergeResult {
  record: MedicalRecord;
  conflicts: FieldConflict[];
  /** True when every field could be merged without user input. */
  autoMerged: boolean;
}

/**
 * Field-aware merge. Fields that are unchanged on either side are merged
 * automatically; only fields edited on both sides are surfaced as conflicts.
 * Never silently overwrites: conflicting fields keep the local value until the
 * user picks a resolution.
 */
export function mergeMedicalRecord(
  base: MedicalRecord,
  local: MedicalRecord,
  remote: MedicalRecord,
): MergeResult {
  const fields: Record<string, FieldValue> = { ...base.fields };
  const conflicts: FieldConflict[] = [];

  const keys = new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);

  for (const key of keys) {
    const baseValue = base.fields[key] ?? null;
    const localValue = local.fields[key] ?? null;
    const remoteValue = remote.fields[key] ?? null;

    const localChanged = localValue !== baseValue;
    const remoteChanged = remoteValue !== baseValue;

    if (localChanged && remoteChanged && localValue !== remoteValue) {
      // Overlapping edit: surface for review, keep local until resolved.
      conflicts.push({
        field: key,
        local: localValue,
        remote: remoteValue,
        base: baseValue,
        resolution: 'local',
      });
      fields[key] = localValue;
    } else if (remoteChanged) {
      fields[key] = remoteValue;
    } else {
      fields[key] = localValue;
    }
  }

  return {
    record: {
      id: local.id,
      version: Math.max(local.version, remote.version) + 1,
      etag: remote.etag,
      fields,
    },
    conflicts,
    autoMerged: conflicts.length === 0,
  };
}

/** Apply the user's per-field choices before pushing the merged record. */
export function applyResolutions(
  result: MergeResult,
  resolutions: Record<string, ConflictResolution>,
): MedicalRecord {
  const fields = { ...result.record.fields };
  for (const conflict of result.conflicts) {
    const choice = resolutions[conflict.field] ?? conflict.resolution;
    if (choice === 'remote') {
      fields[conflict.field] = conflict.remote;
    } else if (choice === 'local') {
      fields[conflict.field] = conflict.local;
    }
  }
  return { ...result.record, fields };
}

const baseRecord: MedicalRecord = {
  id: 'rec-1',
  version: 3,
  etag: 'etag-base',
  fields: {
    diagnosis: 'hypertension',
    dosage: '10mg',
    notes: 'stable',
    followUp: '2024-06-01',
  },
};

const localRecord: MedicalRecord = {
  id: 'rec-1',
  version: 4,
  etag: 'etag-local',
  fields: {
    diagnosis: 'hypertension',
    dosage: '20mg',
    notes: 'stable',
    followUp: '2024-06-01',
  },
};

const remoteRecord: MedicalRecord = {
  id: 'rec-1',
  version: 5,
  etag: 'etag-remote',
  fields: {
    diagnosis: 'hypertension',
    dosage: '10mg',
    notes: 'improving',
    followUp: '2024-06-01',
  },
};

const overlappingRemote: MedicalRecord = {
  ...remoteRecord,
  fields: { ...remoteRecord.fields, dosage: '40mg' },
};

export const fixtures = {
  base: baseRecord,
  local: localRecord,
  remote: remoteRecord,
  overlappingRemote,
};

export const scenarios = {
  /** Clean merge: local and remote touched different fields. */
  cleanMerge: () => mergeMedicalRecord(baseRecord, localRecord, remoteRecord),

  /** Conflict: both sides edited `dosage` differently. */
  conflict: () => mergeMedicalRecord(baseRecord, localRecord, overlappingRemote),

  /** Retry: re-apply resolutions after a failed push. */
  retry: () => {
    const merged = mergeMedicalRecord(baseRecord, localRecord, overlappingRemote);
    const resolved = applyResolutions(merged, { dosage: 'remote' });
    return applyResolutions(merged, { dosage: 'remote' });
  },

  /** Discard: user rejects the remote change and keeps local. */
  discard: () => {
    const merged = mergeMedicalRecord(baseRecord, localRecord, overlappingRemote);
    return applyResolutions(merged, { dosage: 'local' });
  },
};
