/**
 * Clinical-note optimistic concurrency (issue #967)
 *
 * Two clinicians editing the same note must not silently overwrite each other.
 * Every note carries a monotonically increasing `version`. An update sends the
 * `baseVersion` it was derived from; if the server has moved on, the write is
 * rejected as a conflict and the caller is shown both sides for review. Applied
 * changes are appended to an immutable amendment history — prior text is never
 * mutated in place.
 */

export type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';

export interface SoapBody {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface VersionedNote extends SoapBody {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface NoteAmendment extends SoapBody {
  /** Version this amendment produced. */
  version: number;
  /** Version it was based on. */
  baseVersion: number;
  authorId: string;
  amendedAt: string;
  /** Immutable snapshot of the note as it was *before* this amendment. */
  previous: SoapBody;
}

export interface FieldConflict {
  field: SoapField;
  base: string;
  mine: string;
  theirs: string;
}

export class NoteConcurrencyError extends Error {
  readonly code = 'VERSION_CONFLICT';
  readonly baseVersion: number;
  readonly serverVersion: number;
  readonly conflicts: FieldConflict[];
  constructor(baseVersion: number, serverVersion: number, conflicts: FieldConflict[]) {
    super(
      `Note was modified by another clinician (you edited v${baseVersion}, server is at v${serverVersion})`,
    );
    this.name = 'NoteConcurrencyError';
    this.baseVersion = baseVersion;
    this.serverVersion = serverVersion;
    this.conflicts = conflicts;
  }
}

const SOAP_FIELDS: SoapField[] = ['subjective', 'objective', 'assessment', 'plan'];

const pickBody = (n: SoapBody): SoapBody => ({
  subjective: n.subjective,
  objective: n.objective,
  assessment: n.assessment,
  plan: n.plan,
});

/**
 * Returns the per-field conflicts between the version the editor started from
 * (`base`), their pending edits (`mine`) and what the server now holds
 * (`theirs`). A field only conflicts when both sides changed it to different
 * values.
 */
export function detectConflicts(base: SoapBody, mine: SoapBody, theirs: SoapBody): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  for (const field of SOAP_FIELDS) {
    const changedByMe = mine[field] !== base[field];
    const changedByThem = theirs[field] !== base[field];
    if (changedByMe && changedByThem && mine[field] !== theirs[field]) {
      conflicts.push({ field, base: base[field], mine: mine[field], theirs: theirs[field] });
    }
  }
  return conflicts;
}

/**
 * Validates an optimistic update. Throws {@link NoteConcurrencyError} when the
 * server has advanced past `baseVersion` and the two sets of edits genuinely
 * collide; a no-op or non-overlapping change is allowed to proceed.
 */
export function assertUpdatable(
  baseVersion: number,
  server: VersionedNote,
  mine: SoapBody,
  base: SoapBody,
): void {
  if (server.version === baseVersion) return;
  const conflicts = detectConflicts(base, mine, pickBody(server));
  if (conflicts.length > 0) {
    throw new NoteConcurrencyError(baseVersion, server.version, conflicts);
  }
}

/**
 * Builds an immutable amendment entry capturing the note as it was before the
 * change. The returned object is frozen; callers append it to history rather
 * than editing earlier entries.
 */
export function buildAmendment(
  previous: VersionedNote,
  next: SoapBody,
  authorId: string,
  amendedAt: string = new Date().toISOString(),
): NoteAmendment {
  return Object.freeze({
    version: previous.version + 1,
    baseVersion: previous.version,
    authorId,
    amendedAt,
    previous: Object.freeze(pickBody(previous)),
    ...pickBody(next),
  });
}

/** Appends an amendment to history, returning a new frozen array. */
export function appendAmendment(
  history: readonly NoteAmendment[],
  amendment: NoteAmendment,
): readonly NoteAmendment[] {
  return Object.freeze([...history, amendment]);
}
