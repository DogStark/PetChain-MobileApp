import { createHash } from 'crypto';

import type { StoredMedicalRecord, StoredPet } from '../server/store';

export type VaccinationSpecies = 'dog' | 'cat';
export type VaccinationStatus = 'administered' | 'overdue' | 'due_soon' | 'upcoming';

export interface VaccinationScheduleEntry {
  id: string;
  species: VaccinationSpecies;
  vaccineName: string;
  diseaseCoverage: string[];
  dueAgeWeeks: number;
  minimumAgeWeeks: number;
  boosterIntervalMonths?: number;
  core: boolean;
  notes: string;
  breedRiskTags?: string[];
}

export interface VaccinationHistoryRecord {
  id: string;
  petId: string;
  vaccineName: string;
  administeredDate: string;
  vetId: string;
  lotNumber?: string;
  manufacturer?: string;
  expiresAt?: string;
  nextDueDate?: string;
  blockchainTxHash?: string;
  blockchainHash?: string;
  isBlockchainVerified?: boolean;
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

export const REMINDER_LEAD_DAYS = [30, 7, 1] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export const STANDARD_VACCINATION_SCHEDULES: VaccinationScheduleEntry[] = [
  {
    id: 'dog-da2pp-6w',
    species: 'dog',
    vaccineName: 'DA2PP',
    diseaseCoverage: ['distemper', 'adenovirus', 'parvovirus', 'parainfluenza'],
    dueAgeWeeks: 6,
    minimumAgeWeeks: 6,
    boosterIntervalMonths: 12,
    core: true,
    notes: 'Begin puppy core series at 6-8 weeks, then boost every 3-4 weeks until 16 weeks.',
  },
  {
    id: 'dog-da2pp-10w',
    species: 'dog',
    vaccineName: 'DA2PP',
    diseaseCoverage: ['distemper', 'adenovirus', 'parvovirus', 'parainfluenza'],
    dueAgeWeeks: 10,
    minimumAgeWeeks: 10,
    core: true,
    notes: 'Puppy core series booster.',
  },
  {
    id: 'dog-da2pp-14w',
    species: 'dog',
    vaccineName: 'DA2PP',
    diseaseCoverage: ['distemper', 'adenovirus', 'parvovirus', 'parainfluenza'],
    dueAgeWeeks: 14,
    minimumAgeWeeks: 14,
    core: true,
    notes: 'Final puppy core booster before annual revaccination.',
  },
  {
    id: 'dog-rabies-16w',
    species: 'dog',
    vaccineName: 'Rabies',
    diseaseCoverage: ['rabies'],
    dueAgeWeeks: 16,
    minimumAgeWeeks: 12,
    boosterIntervalMonths: 12,
    core: true,
    notes: 'Administer according to local rabies law and product label.',
  },
  {
    id: 'dog-bordetella-12w',
    species: 'dog',
    vaccineName: 'Bordetella',
    diseaseCoverage: ['kennel cough'],
    dueAgeWeeks: 12,
    minimumAgeWeeks: 8,
    boosterIntervalMonths: 12,
    core: false,
    notes: 'Recommended for dogs with grooming, boarding, day-care, or dog-park exposure.',
    breedRiskTags: ['social', 'boarding'],
  },
  {
    id: 'dog-leptospirosis-12w',
    species: 'dog',
    vaccineName: 'Leptospirosis',
    diseaseCoverage: ['leptospirosis'],
    dueAgeWeeks: 12,
    minimumAgeWeeks: 8,
    boosterIntervalMonths: 12,
    core: false,
    notes: 'Risk-based vaccine for outdoor, sporting, and wildlife-exposed dogs.',
    breedRiskTags: ['outdoor', 'sporting', 'working'],
  },
  {
    id: 'cat-fvrcp-6w',
    species: 'cat',
    vaccineName: 'FVRCP',
    diseaseCoverage: ['viral rhinotracheitis', 'calicivirus', 'panleukopenia'],
    dueAgeWeeks: 6,
    minimumAgeWeeks: 6,
    boosterIntervalMonths: 12,
    core: true,
    notes: 'Begin kitten core series at 6-8 weeks, then boost every 3-4 weeks until 16 weeks.',
  },
  {
    id: 'cat-fvrcp-10w',
    species: 'cat',
    vaccineName: 'FVRCP',
    diseaseCoverage: ['viral rhinotracheitis', 'calicivirus', 'panleukopenia'],
    dueAgeWeeks: 10,
    minimumAgeWeeks: 10,
    core: true,
    notes: 'Kitten core series booster.',
  },
  {
    id: 'cat-fvrcp-14w',
    species: 'cat',
    vaccineName: 'FVRCP',
    diseaseCoverage: ['viral rhinotracheitis', 'calicivirus', 'panleukopenia'],
    dueAgeWeeks: 14,
    minimumAgeWeeks: 14,
    core: true,
    notes: 'Final kitten core booster before annual revaccination.',
  },
  {
    id: 'cat-rabies-16w',
    species: 'cat',
    vaccineName: 'Rabies',
    diseaseCoverage: ['rabies'],
    dueAgeWeeks: 16,
    minimumAgeWeeks: 12,
    boosterIntervalMonths: 12,
    core: true,
    notes: 'Administer according to local rabies law and product label.',
  },
  {
    id: 'cat-felv-8w',
    species: 'cat',
    vaccineName: 'FeLV',
    diseaseCoverage: ['feline leukemia virus'],
    dueAgeWeeks: 8,
    minimumAgeWeeks: 8,
    boosterIntervalMonths: 12,
    core: false,
    notes: 'Recommended for kittens and cats with outdoor or unknown-status cat exposure.',
    breedRiskTags: ['outdoor', 'multi-cat'],
  },
];

const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const addMonths = (date: Date, months: number): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));

const normalize = (value = ''): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const recordVaccineName = (record: StoredMedicalRecord): string =>
  record.treatment || record.diagnosis || record.notes || record.type;

export const getStandardVaccinationSchedules = (species?: string): VaccinationScheduleEntry[] => {
  const normalizedSpecies = species?.toLowerCase();
  return STANDARD_VACCINATION_SCHEDULES.filter(
    (entry) => !normalizedSpecies || entry.species === normalizedSpecies,
  );
};

export const getVaccinationHistory = (records: StoredMedicalRecord[]): VaccinationHistoryRecord[] =>
  records
    .filter((record) => normalize(record.type).includes('vaccination'))
    .map((record) => ({
      id: record.id,
      petId: record.petId,
      vaccineName: recordVaccineName(record),
      administeredDate: record.visitDate,
      vetId: record.vetId,
      nextDueDate: record.nextVisitDate,
      blockchainTxHash: record.blockchainTxHash,
      blockchainHash: record.blockchainHash,
      isBlockchainVerified: record.isBlockchainVerified,
    }))
    .sort((a, b) => a.administeredDate.localeCompare(b.administeredDate));

export const generateVaccinationReminders = (
  pet: StoredPet,
  medicalRecords: StoredMedicalRecord[],
  asOf: Date = new Date(),
): VaccinationReminder[] => {
  const species = pet.species.toLowerCase();
  if (species !== 'dog' && species !== 'cat') return [];
  if (!pet.dateOfBirth) return [];

  const birthDate = new Date(`${pet.dateOfBirth.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(birthDate.getTime())) return [];

  const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const history = getVaccinationHistory(medicalRecords.filter((record) => record.petId === pet.id));

  return getStandardVaccinationSchedules(species).map((schedule) => {
    const matchingHistory = history.filter(
      (record) =>
        normalize(record.vaccineName).includes(normalize(schedule.vaccineName)) ||
        normalize(schedule.vaccineName).includes(normalize(record.vaccineName)),
    );
    const latest = matchingHistory.at(-1);
    const initialDueDate = addDays(birthDate, schedule.dueAgeWeeks * 7);
    const explicitNextDue = latest?.nextDueDate
      ? new Date(`${latest.nextDueDate.slice(0, 10)}T00:00:00.000Z`)
      : null;
    const nextBoosterDue =
      latest && schedule.boosterIntervalMonths
        ? addMonths(
            new Date(`${latest.administeredDate.slice(0, 10)}T00:00:00.000Z`),
            schedule.boosterIntervalMonths,
          )
        : null;
    const dueDate =
      explicitNextDue && !Number.isNaN(explicitNextDue.getTime())
        ? explicitNextDue
        : nextBoosterDue && nextBoosterDue > initialDueDate
          ? nextBoosterDue
          : initialDueDate;
    const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / DAY_MS);
    const administeredForThisAge = matchingHistory.some((record) => {
      const administered = new Date(`${record.administeredDate.slice(0, 10)}T00:00:00.000Z`);
      return (
        administered >= addDays(initialDueDate, -14) && administered <= addDays(initialDueDate, 42)
      );
    });
    const boosterIsDue = Boolean(
      latest && schedule.boosterIntervalMonths && dueDate > initialDueDate,
    );
    const status: VaccinationStatus =
      administeredForThisAge && !boosterIsDue
        ? 'administered'
        : daysUntilDue < 0
          ? 'overdue'
          : daysUntilDue <= 30
            ? 'due_soon'
            : 'upcoming';

    return {
      id: `${pet.id}-${schedule.id}`,
      scheduleId: schedule.id,
      petId: pet.id,
      vaccineName: schedule.vaccineName,
      dueDate: toDateOnly(dueDate),
      status,
      reminderDates: REMINDER_LEAD_DAYS.map((days) => addDays(dueDate, -days))
        .filter((date) => date > today)
        .map(toDateOnly),
      lastAdministeredDate: latest?.administeredDate,
      veterinaryVerification: latest
        ? {
            vetId: latest.vetId,
            blockchainTxHash: latest.blockchainTxHash,
            blockchainHash: latest.blockchainHash,
            verifiedAt: latest.isBlockchainVerified ? latest.administeredDate : undefined,
          }
        : undefined,
      schedule,
    };
  });
};

export const buildVaccinationRecordHash = (record: VaccinationHistoryRecord): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: record.id,
        petId: record.petId,
        vaccineName: record.vaccineName,
        administeredDate: record.administeredDate,
        vetId: record.vetId,
        lotNumber: record.lotNumber,
        manufacturer: record.manufacturer,
      }),
    )
    .digest('hex');

export const exportVaccinationCertificate = (
  pet: StoredPet,
  medicalRecords: StoredMedicalRecord[],
  issuedAt: Date = new Date(),
): string => {
  const history = getVaccinationHistory(medicalRecords.filter((record) => record.petId === pet.id));
  const lines = [
    'PetChain Vaccination Certificate',
    `Issued: ${issuedAt.toISOString()}`,
    '',
    `Pet: ${pet.name}`,
    `Species: ${pet.species}`,
    `Breed: ${pet.breed ?? 'Unknown'}`,
    `Date of Birth: ${pet.dateOfBirth ?? 'Unknown'}`,
    `Microchip ID: ${pet.microchipId ?? 'Not recorded'}`,
    '',
    'Vaccination History',
    '-------------------',
  ];

  if (history.length === 0) {
    lines.push('No vaccinations recorded.');
  } else {
    history.forEach((record) => {
      lines.push(
        `${record.administeredDate} | ${record.vaccineName} | Vet: ${record.vetId} | ` +
          `Blockchain: ${record.blockchainTxHash ?? 'pending'}`,
      );
    });
  }

  lines.push('', 'Upcoming Schedule', '-----------------');
  generateVaccinationReminders(pet, medicalRecords, issuedAt).forEach((reminder) => {
    lines.push(`${reminder.dueDate} | ${reminder.vaccineName} | ${reminder.status}`);
  });

  return lines.join('\n');
};
