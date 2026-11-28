/**
 * Travel document expiry reminders — Issue #1153
 *
 * Surfaces uploaded travel documents that are expired or expiring soon. Only
 * server-returned expiry dates are used, and the edit/re-upload path is only
 * offered when the server says the user may edit the document. Document file
 * contents and numbers are never cached; only type, dates and links are.
 */

import api from './api';
import { readThroughCache, type ServerReadResult } from './offlineServerCache';

export interface TravelDocument {
  id: string;
  petId: string;
  /** Document type label, e.g. "Rabies certificate". */
  title: string;
  /** Server-provided ISO expiry timestamp. */
  expiresAt: string;
  /** Server-confirmed edit permission. */
  canEdit: boolean;
  /** Server-provided path for editing / re-uploading the document. */
  reuploadPath?: string;
}

export type ExpiryState = 'expired' | 'expiring' | 'valid';

export interface TravelDocumentReminder {
  document: TravelDocument;
  state: ExpiryState;
  daysRemaining: number;
  accessibilityLabel: string;
}

export const DEFAULT_REMINDER_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeDocuments(raw: unknown): TravelDocument[] | null {
  const list = Array.isArray(raw) ? raw : (raw as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(list)) return null;
  return list.flatMap((d): TravelDocument[] => {
    const v = d as Record<string, unknown> | null;
    if (!v || typeof v.id !== 'string' || typeof v.petId !== 'string') return [];
    if (typeof v.title !== 'string' || typeof v.expiresAt !== 'string') return [];
    if (Number.isNaN(Date.parse(v.expiresAt))) return [];
    const links = (v.links ?? {}) as Record<string, unknown>;
    const reupload = typeof links.reupload === 'string' ? links.reupload : undefined;
    return [
      {
        id: v.id,
        petId: v.petId,
        title: v.title,
        expiresAt: v.expiresAt,
        canEdit: (v.permissions as { canEdit?: unknown } | undefined)?.canEdit === true,
        // Only accept app-relative paths from the server.
        reuploadPath:
          reupload?.startsWith('/') && !reupload.startsWith('//') ? reupload : undefined,
      },
    ];
  });
}

export function getExpiryState(
  doc: TravelDocument,
  now = Date.now(),
  windowDays = DEFAULT_REMINDER_WINDOW_DAYS,
): { state: ExpiryState; daysRemaining: number } {
  const daysRemaining = Math.ceil((Date.parse(doc.expiresAt) - now) / DAY_MS);
  if (daysRemaining <= 0) return { state: 'expired', daysRemaining };
  if (daysRemaining <= windowDays) return { state: 'expiring', daysRemaining };
  return { state: 'valid', daysRemaining };
}

function describe(doc: TravelDocument, state: ExpiryState, days: number): string {
  if (state === 'expired') return `${doc.title} has expired. Re-upload required.`;
  return `${doc.title} expires in ${days} day${days === 1 ? '' : 's'}.`;
}

export function buildReminders(
  docs: TravelDocument[],
  now = Date.now(),
  windowDays = DEFAULT_REMINDER_WINDOW_DAYS,
): TravelDocumentReminder[] {
  return docs
    .map((document) => ({ document, ...getExpiryState(document, now, windowDays) }))
    .filter((r) => r.state !== 'valid')
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
    .map((r) => ({ ...r, accessibilityLabel: describe(r.document, r.state, r.daysRemaining) }));
}

export interface TravelDocumentReminderResult extends Omit<
  ServerReadResult<TravelDocument[]>,
  'data'
> {
  reminders: TravelDocumentReminder[];
}

export async function loadTravelDocumentReminders(
  petId: string,
  opts: { now?: number; windowDays?: number; retryDelayMs?: number } = {},
): Promise<TravelDocumentReminderResult> {
  const now = opts.now ?? Date.now();
  const { data, ...meta } = await readThroughCache({
    cacheKey: `travelDocuments:${petId}`,
    fetch: async () => (await api.get(`/pets/${encodeURIComponent(petId)}/travel-documents`)).data,
    normalize: normalizeDocuments,
    now,
    retryDelayMs: opts.retryDelayMs,
  });
  return { ...meta, reminders: data ? buildReminders(data, now, opts.windowDays) : [] };
}

/**
 * Edit/re-upload target for a document, or null when the server has not
 * granted edit access or returned no path.
 */
export function getReuploadPath(doc: TravelDocument): string | null {
  return doc.canEdit && doc.reuploadPath ? doc.reuploadPath : null;
}
