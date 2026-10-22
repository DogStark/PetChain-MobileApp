import { randomUUID } from 'crypto';

import { AppointmentStatus, AppointmentType } from '../models/Appointment';
import { MedicationFrequency, MedicationStatus } from '../models/Medication';
import { UserRole } from '../models/UserRole';
import { stellarAnchorService } from '../services/stellarService';
import { query } from '../src/db';

export type SeedPresetName = 'minimal' | 'standard' | 'large';

export interface SeedConfig {
  preset?: SeedPresetName;
  numOwners?: number;
  numVets?: number;
  petsPerOwner?: number;
  recordsPerPet?: number;
  appointmentsPerPet?: number;
  medicationsPerPet?: number;
  cleanup?: boolean;
  seedBlockchain?: boolean;
}

export const SEED_PRESETS: Record<
  SeedPresetName,
  Required<Omit<SeedConfig, 'preset' | 'cleanup' | 'seedBlockchain'>>
> = {
  minimal: {
    numOwners: 2,
    numVets: 1,
    petsPerOwner: 1,
    recordsPerPet: 1,
    appointmentsPerPet: 1,
    medicationsPerPet: 1,
  },
  standard: {
    numOwners: 5,
    numVets: 3,
    petsPerOwner: 2,
    recordsPerPet: 3,
    appointmentsPerPet: 2,
    medicationsPerPet: 1,
  },
  large: {
    numOwners: 20,
    numVets: 8,
    petsPerOwner: 3,
    recordsPerPet: 5,
    appointmentsPerPet: 3,
    medicationsPerPet: 2,
  },
};

const DEFAULT_CONFIG: Required<SeedConfig> = {
  preset: 'standard',
  numOwners: SEED_PRESETS.standard.numOwners,
  numVets: SEED_PRESETS.standard.numVets,
  petsPerOwner: SEED_PRESETS.standard.petsPerOwner,
  recordsPerPet: SEED_PRESETS.standard.recordsPerPet,
  appointmentsPerPet: SEED_PRESETS.standard.appointmentsPerPet,
  medicationsPerPet: SEED_PRESETS.standard.medicationsPerPet,
  cleanup: false,
  seedBlockchain: false,
};

// Sample data generators
const FIRST_NAMES = ['John', 'Sarah', 'Michael', 'Emma', 'David', 'Lisa', 'James', 'Anna'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
const PET_NAMES = [
  'Buddy',
  'Max',
  'Luna',
  'Charlie',
  'Bella',
  'Rocky',
  'Daisy',
  'Cooper',
  'Lucy',
  'Milo',
];
const SPECIES = ['dog', 'cat', 'rabbit', 'bird'];
const BREEDS: Record<string, string[]> = {
  dog: ['Labrador', 'Golden Retriever', 'German Shepherd', 'Bulldog', 'Poodle', 'Beagle'],
  cat: ['Persian', 'Siamese', 'Maine Coon', 'Bengal', 'Ragdoll'],
  rabbit: ['Holland Lop', 'Flemish Giant', 'Angora'],
  bird: ['Parrot', 'Canary', 'Cockatiel'],
};

const MEDICAL_TYPES = ['checkup', 'vaccination', 'surgery', 'treatment', 'other'];
const MEDICAL_HISTORY_TEMPLATES = [
  'Routine wellness screening with normal vitals',
  'Mild ear irritation resolved with topical treatment',
  'Dental cleaning completed; plaque reduction noted',
  'Post-surgery follow-up with steady recovery trend',
  'Seasonal allergy flare-up managed with diet adjustment',
];
const DIAGNOSES = [
  'Annual wellness exam',
  'Ear infection',
  'Dental cleaning',
  'Skin allergy',
  'Routine vaccination',
  'Post-surgery follow-up',
];
const TREATMENTS = [
  'Prescribed antibiotics',
  'Recommended diet change',
  'Scheduled surgery',
  'Applied topical treatment',
  'Administered vaccine',
  'Prescribed pain medication',
];

const APPOINTMENT_TYPES = [
  AppointmentType.ROUTINE_CHECKUP,
  AppointmentType.VACCINATION,
  AppointmentType.DENTAL,
  AppointmentType.FOLLOW_UP,
];

const MEDICATION_NAMES = [
  'Amoxicillin',
  'Prednisone',
  'Gabapentin',
  'Apoquel',
  'Cerenia',
  'Metacam',
  'Clavamox',
  'Furosemide',
];

const MEDICATION_SCHEDULES = [
  'Give with breakfast and evening meal',
  'Monitor appetite and water intake after each dose',
  'Administer after exercise to reduce joint discomfort',
  'Offer with a small treat to encourage compliance',
];

const MEDICATION_FREQUENCIES = [
  MedicationFrequency.ONCE_DAILY,
  MedicationFrequency.TWICE_DAILY,
  MedicationFrequency.EVERY_OTHER_DAY,
  MedicationFrequency.AS_NEEDED,
];

// Utility functions
export function resolveSeedConfig(config: Partial<SeedConfig> = {}): Required<SeedConfig> {
  const presetName = config.preset && config.preset in SEED_PRESETS ? config.preset : 'standard';
  const preset = SEED_PRESETS[presetName];

  return {
    ...DEFAULT_CONFIG,
    preset: presetName,
    ...preset,
    ...config,
    numOwners: config.numOwners ?? preset.numOwners,
    numVets: config.numVets ?? preset.numVets,
    petsPerOwner: config.petsPerOwner ?? preset.petsPerOwner,
    recordsPerPet: config.recordsPerPet ?? preset.recordsPerPet,
    appointmentsPerPet: config.appointmentsPerPet ?? preset.appointmentsPerPet,
    medicationsPerPet: config.medicationsPerPet ?? preset.medicationsPerPet,
  };
}

export function buildSeedSummary(config: Partial<SeedConfig>) {
  const finalConfig = resolveSeedConfig(config);
  const pets = finalConfig.numOwners * finalConfig.petsPerOwner;

  return {
    owners: finalConfig.numOwners,
    vets: finalConfig.numVets,
    pets,
    medicalRecords: pets * finalConfig.recordsPerPet,
    appointments: pets * finalConfig.appointmentsPerPet,
    medications: pets * finalConfig.medicationsPerPet,
  };
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomEmail(firstName: string, lastName: string, domain: string = 'example.com'): string {
  const suffix = randomInt(100, 999);
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${suffix}@${domain}`;
}

function randomPhone(): string {
  return `+1${randomInt(2000000000, 9999999999)}`;
}

function randomDate(daysAgo: number = 365): string {
  const date = new Date();
  date.setDate(date.getDate() - randomInt(0, daysAgo));
  return date.toISOString().split('T')[0];
}

function futureDate(daysFromNow: number = 30): string {
  const date = new Date();
  date.setDate(date.getDate() + randomInt(1, daysFromNow));
  return date.toISOString().split('T')[0];
}

function randomTime(): string {
  const hour = randomInt(8, 17);
  const minute = randomInt(0, 5) * 15;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

type SeededRecordIds = {
  users: string[];
  pets: string[];
  medicalRecords: string[];
  appointments: string[];
  medications: string[];
};

async function ensureSeedTrackingTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS seed_runs (
      id UUID PRIMARY KEY,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS seed_run_users (
      seed_run_id UUID NOT NULL,
      user_id UUID NOT NULL,
      PRIMARY KEY (seed_run_id, user_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS seed_run_pets (
      seed_run_id UUID NOT NULL,
      pet_id UUID NOT NULL,
      PRIMARY KEY (seed_run_id, pet_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS seed_run_medical_records (
      seed_run_id UUID NOT NULL,
      medical_record_id UUID NOT NULL,
      PRIMARY KEY (seed_run_id, medical_record_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS seed_run_appointments (
      seed_run_id UUID NOT NULL,
      appointment_id UUID NOT NULL,
      PRIMARY KEY (seed_run_id, appointment_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS seed_run_medications (
      seed_run_id UUID NOT NULL,
      medication_id UUID NOT NULL,
      PRIMARY KEY (seed_run_id, medication_id)
    );
  `);
}

async function linkSeedRecord(
  seedRunId: string,
  tableName: keyof SeededRecordIds,
  id: string,
): Promise<void> {
  const mapping = {
    users: 'seed_run_users',
    pets: 'seed_run_pets',
    medicalRecords: 'seed_run_medical_records',
    appointments: 'seed_run_appointments',
    medications: 'seed_run_medications',
  } as const;

  const relationTable = mapping[tableName];
  const idColumn = {
    users: 'user_id',
    pets: 'pet_id',
    medicalRecords: 'medical_record_id',
    appointments: 'appointment_id',
    medications: 'medication_id',
  }[tableName];

  await query(
    `INSERT INTO ${relationTable} (seed_run_id, ${idColumn}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [seedRunId, id],
  );
}

async function cleanupSeedData(seedRunId?: string): Promise<void> {
  if (!seedRunId) {
    return;
  }

  const tables = [
    ['seed_run_medications', 'medication_id'],
    ['seed_run_appointments', 'appointment_id'],
    ['seed_run_medical_records', 'medical_record_id'],
    ['seed_run_pets', 'pet_id'],
    ['seed_run_users', 'user_id'],
  ] as const;

  for (const [relationTable, columnName] of tables) {
    await query(
      `DELETE FROM ${relationTable.replace('seed_run_', '')} WHERE id IN (SELECT ${columnName} FROM ${relationTable} WHERE seed_run_id = $1)`,
      [seedRunId],
    );
  }

  await query('DELETE FROM seed_runs WHERE id = $1', [seedRunId]);
}

// Seed functions
async function seedUsers(
  config: Required<SeedConfig>,
  seededIds: SeededRecordIds,
): Promise<Map<string, string>> {
  console.log(`\n📝 Seeding ${config.numOwners} owners and ${config.numVets} vets...`);

  const userIds = new Map<string, string>();
  const ownerIds: string[] = [];
  const vetIds: string[] = [];

  // Create owners
  for (let i = 0; i < config.numOwners; i++) {
    const id = randomUUID();
    const firstName = randomElement(FIRST_NAMES);
    const lastName = randomElement(LAST_NAMES);
    const email = randomEmail(firstName, lastName);

    await query(
      `INSERT INTO users (id, email, name, phone, role, is_email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [id, email, `${firstName} ${lastName}`, randomPhone(), UserRole.OWNER, true],
    );

    ownerIds.push(id);
    seededIds.users.push(id);
    userIds.set(`owner-${i}`, id);
    console.log(`  ✓ Owner: ${email}`);
  }

  // Create vets
  for (let i = 0; i < config.numVets; i++) {
    const id = randomUUID();
    const firstName = randomElement(FIRST_NAMES);
    const lastName = randomElement(LAST_NAMES);
    const email = randomEmail(firstName, lastName, 'vetclinic.com');

    await query(
      `INSERT INTO users (id, email, name, phone, role, is_email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [id, email, `Dr. ${firstName} ${lastName}`, randomPhone(), UserRole.VET, true],
    );

    vetIds.push(id);
    seededIds.users.push(id);
    userIds.set(`vet-${i}`, id);
    console.log(`  ✓ Vet: ${email}`);
  }

  return userIds;
}

async function seedPets(
  config: Required<SeedConfig>,
  userIds: Map<string, string>,
  seededIds: SeededRecordIds,
): Promise<Map<string, string>> {
  console.log(`\n🐾 Seeding pets...`);

  const petIds = new Map<string, string>();
  let petCount = 0;

  for (let ownerIdx = 0; ownerIdx < config.numOwners; ownerIdx++) {
    const ownerId = userIds.get(`owner-${ownerIdx}`);
    if (!ownerId) continue;

    for (let petIdx = 0; petIdx < config.petsPerOwner; petIdx++) {
      const id = randomUUID();
      const name = randomElement(PET_NAMES);
      const species = randomElement(SPECIES);
      const breed = randomElement(BREEDS[species]);
      const dateOfBirth = randomDate(365 * 10);
      const microchipId = `CHIP-${randomInt(100000, 999999)}`;

      await query(
        `INSERT INTO pets (id, name, species, breed, date_of_birth, microchip_id, owner_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [id, name, species, breed, dateOfBirth, microchipId, ownerId],
      );

      petIds.set(`pet-${petCount}`, id);
      seededIds.pets.push(id);
      console.log(`  ✓ Pet: ${name} (${species}, ${breed}) - Owner: ${ownerId.slice(0, 8)}`);
      petCount++;
    }
  }

  return petIds;
}

async function seedMedicalRecords(
  config: Required<SeedConfig>,
  userIds: Map<string, string>,
  petIds: Map<string, string>,
  seededIds: SeededRecordIds,
): Promise<void> {
  console.log(`\n📋 Seeding medical records...`);

  let recordCount = 0;
  const vetIds = Array.from(userIds.entries())
    .filter(([key]) => key.startsWith('vet-'))
    .map(([, id]) => id);

  for (let petIdx = 0; petIdx < petIds.size; petIdx++) {
    const petId = petIds.get(`pet-${petIdx}`);
    if (!petId) continue;

    for (let recordIdx = 0; recordIdx < config.recordsPerPet; recordIdx++) {
      const id = randomUUID();
      const vetId = randomElement(vetIds);
      const type = randomElement(MEDICAL_TYPES);
      const diagnosis = randomElement(DIAGNOSES);
      const treatment = randomElement(TREATMENTS);
      const history = randomElement(MEDICAL_HISTORY_TEMPLATES);
      const visitDate = randomDate(180);
      const nextVisitDate = new Date(new Date(visitDate).getTime() + 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      await query(
        `INSERT INTO medical_records (id, pet_id, vet_id, type, diagnosis, treatment, notes, visit_date, next_visit_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [id, petId, vetId, type, diagnosis, treatment, history, visitDate, nextVisitDate],
      );

      seededIds.medicalRecords.push(id);
      recordCount++;
      console.log(`  ✓ Record: ${type} - ${diagnosis}`);
    }
  }

  console.log(`  Total records created: ${recordCount}`);
}

async function seedAppointments(
  config: Required<SeedConfig>,
  userIds: Map<string, string>,
  petIds: Map<string, string>,
  seededIds: SeededRecordIds,
): Promise<void> {
  console.log(`\n📅 Seeding appointments...`);

  let appointmentCount = 0;
  const vetIds = Array.from(userIds.entries())
    .filter(([key]) => key.startsWith('vet-'))
    .map(([, id]) => id);

  for (let petIdx = 0; petIdx < petIds.size; petIdx++) {
    const petId = petIds.get(`pet-${petIdx}`);
    if (!petId) continue;

    for (let apptIdx = 0; apptIdx < config.appointmentsPerPet; apptIdx++) {
      const id = randomUUID();
      const vetId = randomElement(vetIds);
      const date = futureDate(60);
      const time = randomTime();
      const type = randomElement(APPOINTMENT_TYPES);
      const status = randomElement([
        AppointmentStatus.PENDING,
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.COMPLETED,
      ]);

      await query(
        `INSERT INTO appointments (id, pet_id, vet_id, date, time, duration_minutes, type, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [id, petId, vetId, date, time, 30, type, status],
      );

      seededIds.appointments.push(id);
      appointmentCount++;
      console.log(`  ✓ Appointment: ${type} on ${date} at ${time}`);
    }
  }

  console.log(`  Total appointments created: ${appointmentCount}`);
}

async function seedMedications(
  config: Required<SeedConfig>,
  petIds: Map<string, string>,
  seededIds: SeededRecordIds,
): Promise<void> {
  console.log(`\n💊 Seeding medications...`);

  let medicationCount = 0;

  for (let petIdx = 0; petIdx < petIds.size; petIdx++) {
    const petId = petIds.get(`pet-${petIdx}`);
    if (!petId) continue;

    for (let medIdx = 0; medIdx < config.medicationsPerPet; medIdx++) {
      const id = randomUUID();
      const name = randomElement(MEDICATION_NAMES);
      const dosage = `${randomInt(5, 500)}mg`;
      const frequency = randomElement(MEDICATION_FREQUENCIES);
      const instructions = randomElement(MEDICATION_SCHEDULES);
      const startDate = randomDate(90);
      const durationDays = randomInt(7, 90);
      const endDate = new Date(new Date(startDate).getTime() + durationDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      const status = randomElement([MedicationStatus.ACTIVE, MedicationStatus.COMPLETED]);

      await query(
        `INSERT INTO medications (id, pet_id, name, dosage, frequency, start_date, end_date, status, duration_days, instructions, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
        [
          id,
          petId,
          name,
          dosage,
          frequency,
          startDate,
          endDate,
          status,
          durationDays,
          instructions,
        ],
      );

      seededIds.medications.push(id);
      medicationCount++;
      console.log(`  ✓ Medication: ${name} (${dosage}, ${frequency})`);
    }
  }

  console.log(`  Total medications created: ${medicationCount}`);
}

async function seedBlockchainTransactions(
  seedRunId: string,
  medicalRecordIds: string[],
): Promise<void> {
  for (const recordId of medicalRecordIds) {
    try {
      await stellarAnchorService.anchorRecord({
        recordId,
        payload: { recordId, seededAt: seedRunId, network: 'testnet' },
        network: 'testnet',
      });
    } catch (error) {
      console.warn(`  ⚠️  Could not anchor record ${recordId}:`, error);
    }
  }
}

export async function seed(
  config: Partial<SeedConfig> = {},
): Promise<ReturnType<typeof buildSeedSummary>> {
  const finalConfig = resolveSeedConfig(config);

  console.log('\n🌱 Starting PetChain database seeding...');
  console.log('Configuration:', finalConfig);

  const seededIds: SeededRecordIds = {
    users: [],
    pets: [],
    medicalRecords: [],
    appointments: [],
    medications: [],
  };

  try {
    await ensureSeedTrackingTables();

    if (finalConfig.cleanup) {
      console.log('\n🧹 Cleaning prior seed batch markers before generating fresh data...');
      await query('DELETE FROM seed_runs');
    }

    const seedRunId = randomUUID();
    await query('INSERT INTO seed_runs (id, label) VALUES ($1, $2)', [
      seedRunId,
      `${finalConfig.preset}-${Date.now()}`,
    ]);

    const userIds = await seedUsers(finalConfig, seededIds);
    const petIds = await seedPets(finalConfig, userIds, seededIds);
    await seedMedicalRecords(finalConfig, userIds, petIds, seededIds);
    await seedAppointments(finalConfig, userIds, petIds, seededIds);
    await seedMedications(finalConfig, petIds, seededIds);

    for (const [tableName, ids] of Object.entries(seededIds) as Array<
      [keyof SeededRecordIds, string[]]
    >) {
      for (const id of ids) {
        await linkSeedRecord(seedRunId, tableName, id);
      }
    }

    if (finalConfig.seedBlockchain) {
      await seedBlockchainTransactions(seedRunId, seededIds.medicalRecords);
    }

    const summary = buildSeedSummary(finalConfig);

    console.log('\n✅ Seeding completed successfully!');
    console.log('\nSummary:');
    console.log(`  • Users: ${summary.owners} owners + ${summary.vets} vets`);
    console.log(`  • Pets: ${summary.pets}`);
    console.log(`  • Medical Records: ${summary.medicalRecords}`);
    console.log(`  • Appointments: ${summary.appointments}`);
    console.log(`  • Medications: ${summary.medications}`);

    return summary;
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    throw error;
  }
}

export { cleanupSeedData };
