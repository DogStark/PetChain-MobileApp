import axios from 'axios';

import type {
  MedicationAdministration,
  MedicationAdministrationOutcome,
  MedicationScheduledDoseEvent,
  RecordMedicationAdministrationInput,
} from '../models/Medication';

const API_URL = process.env.API_URL || 'http://localhost:3000/api';

interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  startDate: string;
  endDate?: string;
  active: boolean;
  petId: string;
}

export const getMedications = async (petId: string): Promise<Medication[]> => {
  const { data } = await axios.get(`${API_URL}/medications?petId=${petId}`);
  return data;
};

export const createMedication = async (medication: Omit<Medication, 'id'>): Promise<Medication> => {
  const { data } = await axios.post(`${API_URL}/medications`, medication);
  return data;
};

export const updateMedication = async (
  id: string,
  medication: Partial<Medication>,
): Promise<Medication> => {
  const { data } = await axios.put(`${API_URL}/medications/${id}`, medication);
  return data;
};

export const deleteMedication = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/medications/${id}`);
};

export const getActiveMedications = async (petId: string): Promise<Medication[]> => {
  const medications = await getMedications(petId);
  return medications.filter((med) => med.active);
};

/**
 * Fetch the scheduled dose events for a pet within an optional date range.
 */
export const getScheduledDoseEvents = async (
  petId: string,
  options: { from?: string; to?: string } = {},
): Promise<MedicationScheduledDoseEvent[]> => {
  const params = new URLSearchParams({ petId });
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  const query = params.toString();
  const { data } = await auditedGet(
    `${API_URL}/medications/scheduled-doses${query ? `?${query}` : ''}`,
  );
  return data;
};

/**
 * Record a partial, refused, not-given, or full administration outcome
 * against a scheduled dose event. The scheduled event is preserved; the server
 * returns the created administration record.
 */
export const recordMedicationAdministration = async (
  input: RecordMedicationAdministrationInput,
  options: { idempotencyKey?: string } = {},
): Promise<MedicationAdministration> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const idempotencyKey = options.idempotencyKey || input.clientRequestId;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const payload = {
    scheduledDoseEventId: input.scheduledDoseEventId,
    outcome: input.outcome,
    administeredAt: input.administeredAt,
    administeredDose: input.administeredDose,
    reason: input.reason,
    actor: input.actor,
  };

  const { data } = await axios.post(`${API_URL}/medications/administrations`, payload, { headers });
  return data;
};

/**
 * List recorded administrations for a pet, optionally filtered by outcome.
 */
export const getMedicationAdministrations = async (
  petId: string,
  options: { outcome?: MedicationAdministrationOutcome } = {},
): Promise<MedicationAdministration[]> => {
  const params = new URLSearchParams({ petId });
  if (options.outcome) params.set('outcome', options.outcome);
  const { data } = await axios.get(`${API_URL}/medications/administrations?${params.toString()}`);
  return data;
};

/**
 * Internal helper that keeps the axios get call signature consistent and
 * avoids accidentally passing undefined options.
 */
function auditedGet(url: string) {
  return axios.get(url);
}
