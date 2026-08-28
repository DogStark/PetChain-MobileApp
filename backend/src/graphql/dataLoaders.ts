import DataLoader from 'dataloader';

import { query } from '../db';
import { type DBPet } from '../repositories/petRepository';
import { type DBUser } from '../repositories/userRepository';

export interface DBMedicalRecord {
  id: string;
  pet_id: string;
  vet_id: string;
  type: string;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  visit_date: Date;
  next_visit_date?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface DBMedication {
  id: string;
  pet_id: string;
  name: string;
  dosage: string;
  frequency: string;
  duration_days: number;
  start_date: Date;
  end_date?: Date;
  status: string;
  instructions?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DBAppointment {
  id: string;
  pet_id: string;
  vet_id: string;
  date: string;
  time: string;
  duration_minutes?: number;
  type: string;
  status: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

async function batchUsers(ids: readonly string[]): Promise<(DBUser | null)[]> {
  const res = await query(`SELECT * FROM users WHERE id = ANY($1::uuid[])`, [ids]);
  const map = new Map(res.rows.map((u: DBUser) => [u.id, u]));
  return ids.map((id) => map.get(id) ?? null);
}

async function batchPets(ids: readonly string[]): Promise<(DBPet | null)[]> {
  const res = await query(`SELECT * FROM pets WHERE id = ANY($1::uuid[])`, [ids]);
  const map = new Map(res.rows.map((p: DBPet) => [p.id, p]));
  return ids.map((id) => map.get(id) ?? null);
}

async function batchPetsByOwner(ownerIds: readonly string[]): Promise<DBPet[][]> {
  const res = await query(`SELECT * FROM pets WHERE owner_id = ANY($1::uuid[])`, [ownerIds]);
  const map = new Map<string, DBPet[]>();
  for (const pet of res.rows as DBPet[]) {
    const list = map.get(pet.owner_id) ?? [];
    list.push(pet);
    map.set(pet.owner_id, list);
  }
  return ownerIds.map((id) => map.get(id) ?? []);
}

async function batchMedicalRecordsByPet(petIds: readonly string[]): Promise<DBMedicalRecord[][]> {
  const res = await query(
    `SELECT * FROM medical_records WHERE pet_id = ANY($1::uuid[]) ORDER BY visit_date DESC`,
    [petIds],
  );
  const map = new Map<string, DBMedicalRecord[]>();
  for (const r of res.rows as DBMedicalRecord[]) {
    const list = map.get(r.pet_id) ?? [];
    list.push(r);
    map.set(r.pet_id, list);
  }
  return petIds.map((id) => map.get(id) ?? []);
}

async function batchMedicationsByPet(petIds: readonly string[]): Promise<DBMedication[][]> {
  const res = await query(
    `SELECT * FROM medications WHERE pet_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
    [petIds],
  );
  const map = new Map<string, DBMedication[]>();
  for (const m of res.rows as DBMedication[]) {
    const list = map.get(m.pet_id) ?? [];
    list.push(m);
    map.set(m.pet_id, list);
  }
  return petIds.map((id) => map.get(id) ?? []);
}

async function batchAppointmentsByPet(petIds: readonly string[]): Promise<DBAppointment[][]> {
  const res = await query(
    `SELECT * FROM appointments WHERE pet_id = ANY($1::uuid[]) ORDER BY date DESC`,
    [petIds],
  );
  const map = new Map<string, DBAppointment[]>();
  for (const a of res.rows as DBAppointment[]) {
    const list = map.get(a.pet_id) ?? [];
    list.push(a);
    map.set(a.pet_id, list);
  }
  return petIds.map((id) => map.get(id) ?? []);
}

async function batchAppointmentsByVet(vetIds: readonly string[]): Promise<DBAppointment[][]> {
  const res = await query(
    `SELECT * FROM appointments WHERE vet_id = ANY($1::uuid[]) ORDER BY date DESC`,
    [vetIds],
  );
  const map = new Map<string, DBAppointment[]>();
  for (const a of res.rows as DBAppointment[]) {
    const list = map.get(a.vet_id) ?? [];
    list.push(a);
    map.set(a.vet_id, list);
  }
  return vetIds.map((id) => map.get(id) ?? []);
}

export interface DataLoaders {
  userById: DataLoader<string, DBUser | null>;
  petById: DataLoader<string, DBPet | null>;
  petsByOwner: DataLoader<string, DBPet[]>;
  medicalRecordsByPet: DataLoader<string, DBMedicalRecord[]>;
  medicationsByPet: DataLoader<string, DBMedication[]>;
  appointmentsByPet: DataLoader<string, DBAppointment[]>;
  appointmentsByVet: DataLoader<string, DBAppointment[]>;
}

export function createDataLoaders(): DataLoaders {
  return {
    userById: new DataLoader(batchUsers),
    petById: new DataLoader(batchPets),
    petsByOwner: new DataLoader(batchPetsByOwner),
    medicalRecordsByPet: new DataLoader(batchMedicalRecordsByPet),
    medicationsByPet: new DataLoader(batchMedicationsByPet),
    appointmentsByPet: new DataLoader(batchAppointmentsByPet),
    appointmentsByVet: new DataLoader(batchAppointmentsByVet),
  };
}
