import api from './api';
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
