/**
 * Medical record sync with conflict resolution for concurrent offline edits.
 *
 * Records carry version/etag metadata. During sync we compare the local base
 * version against the remote version. If they diverge, we never overwrite
 * either side silently: unchanged fields are merged automatically and
 * conflicting fields are surfaced for field-aware user review.
 */

export interface MedicalRecord {
  id: string;
  version: string;
  etag: string;
  fields: Record<string, unknown>;
}

/** A record as it existed when the local device last synced. */
export interface SyncEnvelope {
  local: MedicalRecord;
  remote: MedicalRecord;
  /** The version both sides shared before either edit. */
  baseVersion: string;
}

export type FieldResolution =
  | { field: string; choice: 'local' }
  | { field: string; choice: 'remote' }
  | { field: string; choice: 'manual'; value: unknown };

export interface ConflictReview {
  recordId: string;
  /** Fields that differ and require an explicit user choice. */
  conflictingFields: string[];
  /** Fields merged automatically because only one side changed them. */
  autoMergedFields: string[];
  local: MedicalRecord;
  remote: MedicalRecord;
}

export interface MergeResult {
  record: MedicalRecord;
  /** True when the merge required user input for at least one field. */
  hadConflicts: boolean;
  /** Replay-safe record of the choices the user made. */
  resolutions: FieldResolution[];
}

function fieldChanged(
  base: Record<string, unknown>,
  side: Record<string, unknown>,
  field: string,
): boolean {
  return !Object.is(base[field], side[field]);
}

/**
 * Detect whether a sync envelope represents a conflict. A conflict exists when
 * the remote version no longer matches the base version the local edit was
 * made against, and the local record was also modified.
 */
export function hasConflict(envelope: SyncEnvelope): boolean {
  const { local, remote, baseVersion } = envelope;
  const localEdited = local.version !== baseVersion;
  const remoteEdited = remote.version !== baseVersion;
  return localEdited && remoteEdited && local.version !== remote.version;
}

/**
 * Build a field-aware review for a conflicting record. Fields changed on only
 * one side are merged automatically; fields changed on both sides are listed
 * for explicit user resolution.
 */
export function buildConflictReview(
  envelope: SyncEnvelope,
  baseFields: Record<string, unknown>,
): ConflictReview {
  const { local, remote } = envelope;
  const allFields = new Set([
    ...Object.keys(baseFields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);

  const conflictingFields: string[] = [];
  const autoMergedFields: string[] = [];

  for (const field of allFields) {
    const localChanged = fieldChanged(baseFields, local.fields, field);
    const remoteChanged = fieldChanged(baseFields, remote.fields, field);

    if (localChanged && remoteChanged) {
      if (!Object.is(local.fields[field], remote.fields[field])) {
        conflictingFields.push(field);
      } else {
        autoMergedFields.push(field);
      }
    } else if (localChanged || remoteChanged) {
      autoMergedFields.push(field);
    }
  }

  return {
    recordId: local.id,
    conflictingFields,
    autoMergedFields,
    local,
    remote,
  };
}

/**
 * Merge a record using the user's field resolutions. Unchanged fields are
 * merged automatically; conflicting fields must be resolved explicitly so no
 * local or remote data is silently overwritten.
 */
export function mergeRecord(
  envelope: SyncEnvelope,
  baseFields: Record<string, unknown>,
  resolutions: FieldResolution[],
): MergeResult {
  const { local, remote } = envelope;
  const review = buildConflictReview(envelope, baseFields);
  const resolutionByField = new Map(
    resolutions.map((resolution) => [resolution.field, resolution]),
  );

  const unresolved = review.conflictingFields.filter(
    (field) => !resolutionByField.has(field),
  );
  if (unresolved.length > 0) {
    throw new Error(
      `Cannot merge record ${local.id}: unresolved conflicting fields: ${unresolved.join(', ')}`,
    );
  }

  const mergedFields: Record<string, unknown> = { ...baseFields };

  for (const field of review.autoMergedFields) {
    const localChanged = fieldChanged(baseFields, local.fields, field);
    mergedFields[field] = localChanged
      ? local.fields[field]
      : remote.fields[field];
  }

  for (const field of review.conflictingFields) {
    const resolution = resolutionByField.get(field)!;
    if (resolution.choice === 'local') {
      mergedFields[field] = local.fields[field];
    } else if (resolution.choice === 'remote') {
      mergedFields[field] = remote.fields[field];
    } else {
      mergedFields[field] = resolution.value;
    }
  }

  return {
    record: {
      id: local.id,
      version: remote.version,
      etag: remote.etag,
      fields: mergedFields,
    },
    hadConflicts: review.conflictingFields.length > 0,
    resolutions,
  };
}

/**
 * Sync a single record. Clean records are applied directly; conflicting
 * records are returned for review instead of being overwritten.
 */
export function syncRecord(
  envelope: SyncEnvelope,
  baseFields: Record<string, unknown>,
): { applied: MedicalRecord } | { review: ConflictReview } {
  if (!hasConflict(envelope)) {
    return { applied: envelope.remote };
  }
  return { review: buildConflictReview(envelope, baseFields) };
}
