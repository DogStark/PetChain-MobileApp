import apiClient from './apiClient';

export type VaccinationStatus = 'administered' | 'overdue' | 'due_soon' | 'upcoming';

export interface VaccinationScheduleEntry {
  id: string;
  species: 'dog' | 'cat';
  vaccineName: string;
  diseaseCoverage: string[];
  dueAgeWeeks: number;
  minimumAgeWeeks: number;
  boosterIntervalMonths?: number;
  core: boolean;
  notes: string;
  breedRiskTags?: string[];
}

export interface VaccinationReminder {
  id: string;
  scheduleId: string;
  petId: string;
  vaccineName: string;
  dueDate: string;
  status: VaccinationStatus;
  reminderDates: string[];
  lastAdministeredDate?: string;
  veterinaryVerification?: {
    vetId: string;
    blockchainTxHash?: string;
    blockchainHash?: string;
    verifiedAt?: string;
  };
  schedule: VaccinationScheduleEntry;
}

export interface AdministeredVaccinationInput {
  petId: string;
  vaccineName: string;
  administeredDate: string;
  vetId?: string;
  lotNumber?: string;
  manufacturer?: string;
  nextDueDate?: string;
  anchorToBlockchain?: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const getVaccinationSchedules = async (
  species?: 'dog' | 'cat',
): Promise<VaccinationScheduleEntry[]> => {
  const { data } = await apiClient.get<ApiEnvelope<VaccinationScheduleEntry[]>>(
    '/vaccinations/schedules',
    {
      params: species ? { species } : undefined,
    },
  );
  return data.data;
};

export const getVaccinationReminders = async (petId: string): Promise<VaccinationReminder[]> => {
  const { data } = await apiClient.get<ApiEnvelope<VaccinationReminder[]>>(
    `/vaccinations/pets/${encodeURIComponent(petId)}/reminders`,
  );
  return data.data;
};

export const markVaccinationAdministered = async (
  input: AdministeredVaccinationInput,
): Promise<unknown> => {
  const { data } = await apiClient.post<ApiEnvelope<unknown>>('/vaccinations/administered', input);
  return data.data;
};

export const exportVaccinationCertificate = async (petId: string): Promise<string> => {
  const { data } = await apiClient.get<string>(
    `/vaccinations/pets/${encodeURIComponent(petId)}/certificate`,
    { responseType: 'text' },
  );
  return data;
};

/**
 * Called after a pet ownership transfer to schedule vaccination notifications
 * on the new owner's device. Cancels any existing local notifications for this
 * pet and re-schedules them from the freshly-fetched reminders.
 *
 * Import scheduleVaccinationReminder and cancelEntityNotification at call-site
 * since this function works purely with the API layer; notification scheduling
 * is done in the component / hook that invokes this helper.
 */
export const getRemindersForTransfer = async (petId: string): Promise<VaccinationReminder[]> => {
  return getVaccinationReminders(petId);
};
