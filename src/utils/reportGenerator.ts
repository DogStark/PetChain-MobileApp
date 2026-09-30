/**
 * Report Generator (#845)
 *
 * Builds a structured, JSON-serialisable health summary for a single pet.
 * The report aggregates medical history, vaccinations, active medications, and
 * appointments from the service layer, and supports optional date-range
 * filtering on every time-stamped section.
 *
 * Usage
 * ──────
 *   import { generateHealthSummary } from './reportGenerator';
 *
 *   const report = await generateHealthSummary('pet-uuid-123');
 *   console.log(JSON.stringify(report, null, 2));
 *
 *   // With date range
 *   const report = await generateHealthSummary('pet-uuid-123', {
 *     dateFrom: '2025-01-01',
 *     dateTo:   '2025-12-31',
 *   });
 *
 * The returned object is safe to pass to JSON.stringify() — no circular refs,
 * no Buffers, no non-serialisable values.
 */

import type { Appointment } from '../models/Appointment';
import type { MedicalRecord, VaccinationRecord } from '../models/MedicalRecord';
import type { Medication } from '../models/Medication';
import type { Pet } from '../models/Pet';

// ─── Service imports ──────────────────────────────────────────────────────────
// All three use module-level exported functions (not class instances).

import { getPetById } from '../services/petService';
import { getMedicalRecords } from '../services/medicalRecordService';
import { getMedications } from '../services/medicationService';
import { getAppointments } from '../services/appointmentService';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Optional parameters that control report scope.
 */
export interface ReportOptions {
  /**
   * ISO-8601 date string (YYYY-MM-DD or full ISO datetime).
   * Records, medications, and appointments *before* this date are excluded.
   */
  dateFrom?: string;

  /**
   * ISO-8601 date string (YYYY-MM-DD or full ISO datetime).
   * Records, medications, and appointments *after* this date are excluded.
   */
  dateTo?: string;

  /**
   * When true, include only active / non-cancelled appointments.
   * Defaults to false (all appointments are included).
   */
  activeAppointmentsOnly?: boolean;

  /**
   * When true, include only active medications.
   * Defaults to false (all medications are included).
   */
  activeMedicationsOnly?: boolean;
}

/** A single vaccination entry as it appears in the report. */
export interface ReportVaccination {
  vaccineName: string;
  administeredAt?: string;
  nextDueDate?: string;
  manufacturer?: string;
  batchNumber?: string;
  /** ID of the parent medical record for traceability */
  recordId: string;
}

/** A condensed medication entry in the report. */
export interface ReportMedication {
  id: string;
  name: string;
  dosage: string;
  /** Hours between doses */
  frequency: number;
  startDate: string;
  endDate?: string;
  status?: string;
  prescribedBy?: string;
  instructions?: string;
  refillDate?: string;
  remainingPills?: number;
}

/** A condensed appointment entry in the report. */
export interface ReportAppointment {
  id: string;
  date: string;
  time: string;
  type: string;
  status: string;
  vetName?: string;
  clinicName?: string;
  notes?: string;
  isTelemedicine?: boolean;
}

/** A condensed medical record entry in the report. */
export interface ReportMedicalRecord {
  id: string;
  recordType: string;
  date: string;
  diagnosisText?: string;
  treatmentText?: string;
  notes?: string;
  nextVisitDate?: string;
  verificationStatus?: string;
  blockchainTxHash?: string;
}

/** Top-level pet summary included in the report. */
export interface ReportPetSummary {
  id: string;
  name: string;
  species: string;
  breed?: string;
  dateOfBirth?: string;
  weightKg?: number;
  microchipId?: string;
  ownerId: string;
}

/**
 * The complete, JSON-serialisable health summary report.
 * Every field is either a primitive, an array of primitives/plain objects,
 * or undefined — safe to pass directly to JSON.stringify().
 */
export interface HealthSummaryReport {
  /** Report schema version — bump when the shape changes in a breaking way */
  schemaVersion: '1.0';

  /** ISO-8601 timestamp of when the report was generated */
  generatedAt: string;

  /**
   * The date window this report covers.
   * Both are undefined when no filter was requested.
   */
  dateRange: {
    from?: string;
    to?: string;
  };

  /** Core pet profile */
  pet: ReportPetSummary;

  /** Chronological medical history within the date range */
  medicalHistory: ReportMedicalRecord[];

  /**
   * All vaccinations extracted from vaccination-type records within the range.
   * Sorted chronologically by administeredAt (or record date as fallback).
   */
  vaccinations: ReportVaccination[];

  /** Medications within the date range (optionally filtered to active only) */
  medications: ReportMedication[];

  /** Appointments within the date range (optionally filtered to active only) */
  appointments: ReportAppointment[];

  /** Quick-glance counts across all sections */
  summary: {
    totalMedicalRecords: number;
    totalVaccinations: number;
    activeMedications: number;
    upcomingAppointments: number;
  };
}

// ─── Date filtering helpers ───────────────────────────────────────────────────

/**
 * Returns true when `dateStr` falls within the inclusive [from, to] range.
 * Either bound may be omitted for an open-ended range.
 * Comparison is on the YYYY-MM-DD prefix so full ISO datetimes work too.
 */
function isWithinRange(dateStr: string | undefined, from?: string, to?: string): boolean {
  if (!dateStr) return true; // absent date → include by default

  const date = dateStr.slice(0, 10); // normalise to YYYY-MM-DD

  if (from && date < from.slice(0, 10)) return false;
  if (to && date > to.slice(0, 10)) return false;

  return true;
}

// ─── Record mapper ────────────────────────────────────────────────────────────

/**
 * Maps the service-layer `MedicalRecord` (from `medicalRecordService`) to the
 * report's flat `ReportMedicalRecord`.
 *
 * The two types overlap but diverge in field names, so we handle both shapes:
 * - `medicalRecordService.MedicalRecord` uses `type` / `notes` / `nextVisitDate`
 * - `models/MedicalRecord` uses `recordType` / `diagnosis.diagnosisText` / `treatment.treatmentText`
 */
function mapMedicalRecord(
  record: MedicalRecord & {
    type?: string;
    veterinarian?: string;
    isBlockchainVerified?: boolean;
  },
): ReportMedicalRecord {
  return {
    id: record.id,
    // service layer uses `type`, model layer uses `recordType`
    recordType: record.recordType ?? (record as { type?: string }).type ?? 'other',
    date: record.date,
    diagnosisText: record.diagnosis?.diagnosisText,
    treatmentText: record.treatment?.treatmentText,
    notes: record.notes,
    nextVisitDate: record.nextVisitDate,
    verificationStatus:
      record.verificationStatus ??
      ((record as { isBlockchainVerified?: boolean }).isBlockchainVerified ? 'verified' : undefined),
    blockchainTxHash: record.blockchainTxHash,
  };
}

// ─── Vaccination extractor ────────────────────────────────────────────────────

function extractVaccinations(records: MedicalRecord[]): ReportVaccination[] {
  const vaccinations: ReportVaccination[] = [];

  for (const record of records) {
    const recType = record.recordType ?? (record as { type?: string }).type;
    if (recType !== 'vaccination') continue;

    const vaxList: VaccinationRecord[] = record.vaccinations ?? [];

    if (vaxList.length === 0) {
      // Vaccination record with no structured entries — still surface it
      vaccinations.push({
        vaccineName: 'Unknown',
        administeredAt: record.date,
        recordId: record.id,
      });
    } else {
      for (const vax of vaxList) {
        vaccinations.push({
          vaccineName: vax.vaccineName,
          administeredAt: vax.administeredAt ?? record.date,
          nextDueDate: vax.nextDueDate,
          manufacturer: vax.manufacturer,
          batchNumber: vax.batchNumber,
          recordId: record.id,
        });
      }
    }
  }

  // Sort chronologically
  vaccinations.sort((a, b) => {
    const dateA = a.administeredAt ?? '';
    const dateB = b.administeredAt ?? '';
    return dateA.localeCompare(dateB);
  });

  return vaccinations;
}

// ─── Medication mapper ────────────────────────────────────────────────────────

function mapMedication(med: Medication): ReportMedication {
  return {
    id: med.id,
    name: med.name,
    dosage: med.dosage,
    frequency: med.frequency,
    startDate: med.startDate,
    endDate: med.endDate,
    status: med.status,
    prescribedBy: med.prescribedBy,
    instructions: med.instructions,
    refillDate: med.refillDate,
    remainingPills: med.remainingPills,
  };
}

// ─── Appointment mapper ───────────────────────────────────────────────────────

function mapAppointment(appt: Appointment): ReportAppointment {
  return {
    id: appt.id,
    date: appt.date,
    time: appt.time,
    type: appt.type,
    status: appt.status,
    vetName: appt.vet?.name ?? appt.vetName,
    clinicName: appt.vet?.clinicName,
    notes: appt.notes,
    isTelemedicine: appt.isTelemedicine,
  };
}

// ─── Pet summary builder ──────────────────────────────────────────────────────

function buildPetSummary(pet: Pet): ReportPetSummary {
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed,
    dateOfBirth: pet.dateOfBirth,
    weightKg: pet.weightKg,
    microchipId: pet.microchipId,
    ownerId: pet.ownerId,
  };
}

// ─── Summary counters ─────────────────────────────────────────────────────────

function countActiveMedications(medications: ReportMedication[]): number {
  return medications.filter((m) => !m.status || m.status === 'active').length;
}

function countUpcomingAppointments(appointments: ReportAppointment[], today: string): number {
  return appointments.filter(
    (a) =>
      a.date >= today &&
      a.status !== 'CANCELLED' &&
      a.status !== 'NO_SHOW' &&
      a.status !== 'COMPLETED',
  ).length;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a structured, JSON-serialisable health summary for a pet.
 *
 * @param petId   - The pet's unique identifier.
 * @param options - Optional date range and filter flags.
 * @returns A fully populated {@link HealthSummaryReport}.
 *
 * @throws {Error} When the pet cannot be retrieved.
 */
export async function generateHealthSummary(
  petId: string,
  options: ReportOptions = {},
): Promise<HealthSummaryReport> {
  const { dateFrom, dateTo, activeAppointmentsOnly = false, activeMedicationsOnly = false } =
    options;

  // ── 1. Fetch pet ──────────────────────────────────────────────────────────
  const pet = await getPetById(petId);

  // ── 2. Fetch medical records ──────────────────────────────────────────────
  // getMedicalRecords returns an AxiosResponse wrapping a PaginatedResponse.
  // We request a large page size to minimise truncation; the caller can apply
  // the dateFrom / dateTo filter via the service layer for server-side paging,
  // then we re-filter client-side for exact matching.
  const recordsResponse = await getMedicalRecords(petId, {
    startDate: dateFrom,
    endDate: dateTo,
    limit: 1000,
  });

  const allRecords = (recordsResponse.data?.data ?? []) as unknown as MedicalRecord[];

  const filteredRecords = allRecords.filter((r) => isWithinRange(r.date, dateFrom, dateTo));

  // Sort chronologically (oldest first)
  filteredRecords.sort((a, b) => a.date.localeCompare(b.date));

  // ── 3. Extract vaccinations from filtered records ─────────────────────────
  const vaccinations = extractVaccinations(filteredRecords);

  // ── 4. Fetch medications ──────────────────────────────────────────────────
  // getMedications() returns all medications for the authenticated user.
  // We filter to the requested pet and date range client-side.
  const allMedications = await getMedications();

  let filteredMedications = allMedications.filter(
    (m) => m.petId === petId && isWithinRange(m.startDate, dateFrom, dateTo),
  );

  if (activeMedicationsOnly) {
    filteredMedications = filteredMedications.filter(
      (m) => !m.status || m.status === 'active',
    );
  }

  // ── 5. Fetch appointments ─────────────────────────────────────────────────
  const allAppointments = await getAppointments(petId);

  let filteredAppointments = allAppointments.filter((a) =>
    isWithinRange(a.date, dateFrom, dateTo),
  );

  if (activeAppointmentsOnly) {
    filteredAppointments = filteredAppointments.filter(
      (a) =>
        a.status !== 'CANCELLED' &&
        a.status !== 'NO_SHOW' &&
        a.status !== 'COMPLETED',
    );
  }

  // Sort appointments chronologically
  filteredAppointments.sort((a, b) => {
    const dtA = `${a.date}T${a.time}`;
    const dtB = `${b.date}T${b.time}`;
    return dtA.localeCompare(dtB);
  });

  // ── 6. Assemble report ────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  const medicalHistory = filteredRecords.map(mapMedicalRecord);
  const reportMedications = filteredMedications.map(mapMedication);
  const reportAppointments = filteredAppointments.map(mapAppointment);

  const report: HealthSummaryReport = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    dateRange: {
      from: dateFrom,
      to: dateTo,
    },
    pet: buildPetSummary(pet),
    medicalHistory,
    vaccinations,
    medications: reportMedications,
    appointments: reportAppointments,
    summary: {
      totalMedicalRecords: medicalHistory.length,
      totalVaccinations: vaccinations.length,
      activeMedications: countActiveMedications(reportMedications),
      upcomingAppointments: countUpcomingAppointments(reportAppointments, today),
    },
  };

  return report;
}

/**
 * Serialise a {@link HealthSummaryReport} to a formatted JSON string.
 *
 * A convenience wrapper around `JSON.stringify(report, null, 2)` that
 * documents intent clearly at the call site.
 */
export function serializeReport(report: HealthSummaryReport): string {
  return JSON.stringify(report, null, 2);
}
