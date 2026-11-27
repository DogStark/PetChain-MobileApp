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

// ─── Client-generated version vectors (issue #1367) ──────────────────────────
//
// Offline edits cannot know the server's `version`, so each edit is tagged with
// a version vector: a map of actor id → counter. Merging two vectors takes the
// per-actor maximum, which lets the server (and the conflict UI) tell whether
// one edit happened-before another or whether they are concurrent.

/** Actor id → monotonically increasing counter for that actor. */
export type VersionVector = Readonly<Record<string, number>>;

/** How a concurrency conflict was settled. */
export type ConflictResolutionChoice = 'mine' | 'theirs' | 'manual';

/** Immutable record of a conflict resolution, for the audit trail. */
export interface ConflictResolutionLog {
  noteId: string;
  /** Version the editor started from. */
  baseVersion: number;
  /** Version the server held when the conflict was detected. */
  serverVersion: number;
  choice: ConflictResolutionChoice;
  /** Which side's text won, per conflicting field. */
  winningVersion: 'mine' | 'theirs' | 'merged';
  /** Id of the clinician who resolved the conflict. */
  resolvedBy: string;
  resolvedAt: string;
  /** Version vector of the edit that was finally accepted. */
  versionVector: VersionVector;
  fields: SoapField[];
}

/** Returns a vector with `actorId`'s counter incremented by one. */
export function incrementVersionVector(
  vector: VersionVector | undefined,
  actorId: string,
): VersionVector {
  return Object.freeze({ ...(vector ?? {}), [actorId]: (vector?.[actorId] ?? 0) + 1 });
}

/** Per-actor maximum of two vectors. */
export function mergeVersionVectors(a: VersionVector, b: VersionVector): VersionVector {
  const merged: Record<string, number> = { ...a };
  for (const [actor, counter] of Object.entries(b)) {
    merged[actor] = Math.max(merged[actor] ?? 0, counter);
  }
  return Object.freeze(merged);
}

/** True when `a` happened-before (or equals) `b` for every actor. */
export function versionVectorDominates(a: VersionVector, b: VersionVector): boolean {
  return Object.keys(a).every((actor) => (a[actor] ?? 0) >= (b[actor] ?? 0));
}

/** True when neither vector dominates the other — i.e. the edits are concurrent. */
export function areVersionVectorsConcurrent(a: VersionVector, b: VersionVector): boolean {
  return !versionVectorDominates(a, b) && !versionVectorDominates(b, a);
}

/**
 * Builds the resolution log entry for a conflict. `winningVersion` is derived
 * from the user's choice so the log always names the text that was kept.
 */
export function buildConflictResolutionLog(input: {
  noteId: string;
  baseVersion: number;
  serverVersion: number;
  choice: ConflictResolutionChoice;
  resolvedBy: string;
  versionVector: VersionVector;
  fields: SoapField[];
  resolvedAt?: string;
}): ConflictResolutionLog {
  const winningVersion =
    input.choice === 'mine' ? 'mine' : input.choice === 'theirs' ? 'theirs' : 'merged';
  return Object.freeze({
    noteId: input.noteId,
    baseVersion: input.baseVersion,
    serverVersion: input.serverVersion,
    choice: input.choice,
    winningVersion,
    resolvedBy: input.resolvedBy,
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
    versionVector: input.versionVector,
    fields: [...input.fields],
  });
}

/**
 * Applies a resolution to the SOAP body. `mine`/`theirs` take that side
 * wholesale; `manual` takes the clinician's hand-merged text.
 */
export function applyConflictResolution(
  choice: ConflictResolutionChoice,
  mine: SoapBody,
  theirs: SoapBody,
  merged?: SoapBody,
): SoapBody {
  if (choice === 'mine') return pickBody(mine);
  if (choice === 'theirs') return pickBody(theirs);
  return pickBody(merged ?? mine);
}
