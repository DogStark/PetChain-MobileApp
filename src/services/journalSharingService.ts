import apiClient from './apiClient';

/**
 * Sharing a symptom journal entry with a linked vet.
 *
 * The entry is delivered as a secure message through the backend
 * messaging service, which also fans out a push notification to the vet.
 * The backend is the source of truth for the "sent" marker so the state
 * survives reinstalls and is visible on every device.
 */

export interface LinkedVet {
  id: string;
  name: string;
  clinicName?: string;
}

export interface JournalShareResult {
  messageId: string;
  sharedAt: string;
  vetId: string;
}

export interface JournalShareState {
  vetId: string;
  sharedAt: string;
}

const JOURNAL_BASE = '/journal-entries';

export const getLinkedVets = async (petId: string): Promise<LinkedVet[]> => {
  if (!petId) {
    throw new Error('Pet ID is required');
  }
  const response = await apiClient.get<{ vets: LinkedVet[] }>(`/pets/${petId}/linked-vets`);
  return response.data?.vets ?? [];
};

export const shareJournalEntryWithVet = async (
  petId: string,
  entryId: string,
  vetId: string,
): Promise<JournalShareResult> => {
  if (!petId || !entryId || !vetId) {
    throw new Error('Pet ID, entry ID and vet ID are required');
  }
  const response = await apiClient.post<JournalShareResult>(
    `${JOURNAL_BASE}/${entryId}/share`,
    { petId, vetId, channel: 'secure_message' },
  );
  return response.data;
};

export const getJournalShareState = async (
  entryId: string,
): Promise<JournalShareState | null> => {
  if (!entryId) {
    return null;
  }
  const response = await apiClient.get<{ share: JournalShareState | null }>(
    `${JOURNAL_BASE}/${entryId}/share`,
  );
  return response.data?.share ?? null;
};

export const journalSharingService = {
  getLinkedVets,
  shareJournalEntryWithVet,
  getJournalShareState,
};
