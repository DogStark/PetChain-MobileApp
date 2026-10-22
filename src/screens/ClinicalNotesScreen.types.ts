// Shared types for the Clinical Notes SOAP screen.
// These mirror backend/services/noteService.ts so the frontend stays in sync.

export type AttachmentType = 'measurement' | 'photo';

export interface ClinicalNoteAttachment {
  id: string; // local-only, stripped before sending to API
  type: AttachmentType;
  label: string;
  value: string;
}

export interface ClinicalNoteAccessControl {
  role: 'owner' | 'vet' | 'clinic' | 'guest';
  entityId: string;
  permission: 'read' | 'comment' | 'edit';
}

/** Shape sent to POST /api/notes */
export interface ClinicalNotePayload {
  vetId: string;
  petId: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  attachments: Omit<ClinicalNoteAttachment, 'id'>[];
  accessControls: ClinicalNoteAccessControl[];
}
