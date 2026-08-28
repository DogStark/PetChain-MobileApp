import api from './api';
import {
  NoteConcurrencyError,
  assertUpdatable,
  type SoapBody,
} from './clinicalNoteConcurrency';
import { deleteSoapDraft, getSoapDraft, upsertSoapDraft, type SoapNoteDraft } from './localDB';

export type { SoapNoteDraft };

// ─── Types ────────────────────────────────────────────────────────────────────

/** Attachment as stored locally (includes a UI-only `id` for keying list items). */
export interface ClinicalNoteAttachment {
  id: string;
  type: 'measurement' | 'photo';
  label: string;
  value: string;
}

export interface ClinicalNoteAccessControl {
  role: 'owner' | 'vet' | 'clinic' | 'guest';
  entityId: string;
  permission: 'read' | 'comment' | 'edit';
}

/** Shape sent to POST /api/notes — no local `id` on attachments. */
export interface CreateNotePayload {
  vetId: string;
  petId: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  attachments: Omit<ClinicalNoteAttachment, 'id'>[];
  accessControls: ClinicalNoteAccessControl[];
}

export interface ClinicalNoteRecord {
  id: string;
  vetId: string;
  petId: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  attachments: Omit<ClinicalNoteAttachment, 'id'>[];
  accessControls: ClinicalNoteAccessControl[];
  stellar_tx_hash?: string | null;
  status: 'draft' | 'anchored';
  created_at: string;
  updated_at: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

/** POST /api/notes — creates and anchors a clinical note on Stellar. */
export async function createNote(payload: CreateNotePayload): Promise<ClinicalNoteRecord> {
  const response = await api.post<{ data: ClinicalNoteRecord }>('/notes', payload);
  return response.data.data;
}

type ServerNote = ClinicalNoteRecord & { version?: number };

export interface UpdateNotePayload extends CreateNotePayload {
  /** Version the editor started from. */
  baseVersion: number;
  /** The note body as it was when editing began — used to compute per-field conflicts. */
  previousBody?: SoapBody;
}

/**
 * PATCH /api/notes/:id — optimistic-concurrency update (issue #967).
 *
 * If the server has advanced past `baseVersion` it responds 409; we then raise a
 * {@link NoteConcurrencyError} (with per-field conflicts when the server echoes
 * the current note) so the UI can show a conflict-review step instead of
 * silently overwriting another clinician's edit.
 */
export async function updateNote(
  id: string,
  payload: UpdateNotePayload,
): Promise<ClinicalNoteRecord> {
  try {
    const response = await api.patch<{ data: ClinicalNoteRecord }>(`/notes/${id}`, payload, {
      headers: { 'If-Match': String(payload.baseVersion) },
    });
    return response.data.data;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 409) throw err;

    const server = (err as { response?: { data?: { data?: ServerNote } } })?.response?.data?.data;
    const mine: SoapBody = {
      subjective: payload.subjective,
      objective: payload.objective,
      assessment: payload.assessment,
      plan: payload.plan,
    };
    const serverVersion = server?.version ?? payload.baseVersion + 1;

    if (server) {
      // Throws NoteConcurrencyError carrying per-field conflicts for the review UI.
      assertUpdatable(
        payload.baseVersion,
        {
          id,
          version: serverVersion,
          updatedAt: server.updated_at,
          updatedBy: server.vetId,
          subjective: server.subjective,
          objective: server.objective,
          assessment: server.assessment,
          plan: server.plan,
        },
        mine,
        payload.previousBody ?? mine,
      );
    }
    throw new NoteConcurrencyError(payload.baseVersion, serverVersion, []);
  }
}

// ─── Local draft helpers ──────────────────────────────────────────────────────

/** Persist a SOAP draft to encrypted local SQLite. */
export async function saveDraftLocally(draft: SoapNoteDraft): Promise<void> {
  await upsertSoapDraft({ ...draft, savedAt: new Date().toISOString() });
}

/** Load the draft for a given petId + vetId pair. */
export async function loadDraft(petId: string, vetId: string): Promise<SoapNoteDraft | null> {
  return getSoapDraft(petId, vetId);
}

/** Remove the local draft after submit or explicit discard. */
export async function clearDraft(petId: string, vetId: string): Promise<void> {
  await deleteSoapDraft(petId, vetId);
}
