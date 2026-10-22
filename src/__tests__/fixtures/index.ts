/**
 * Reusable test fixtures for common test data.
 *
 * Usage:
 *   import { mockUser, mockPet, mockMedicalRecord, mockAppointment } from '../fixtures';
 *
 * Each fixture is a factory function so tests get a fresh copy and can override fields:
 *   const user = mockUser({ name: 'Custom Name' });
 */

import type { Appointment } from '../../../backend/models/Appointment';
import { AppointmentStatus, AppointmentType } from '../../../backend/models/Appointment';
import type { MedicalRecord } from '../../models/MedicalRecord';
import type { Pet } from '../../models/Pet';
import type { User } from '../../models/User';

// ─── Users ───────────────────────────────────────────────────────────────────

export const mockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-001',
  email: 'jane.doe@example.com',
  name: 'Jane Doe',
  phone: '+1-555-0100',
  role: 'owner',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

export const mockVetUser = (overrides: Partial<User> = {}): User => ({
  id: 'vet-001',
  email: 'dr.smith@vetclinic.com',
  name: 'Dr. Alice Smith',
  phone: '+1-555-0200',
  role: 'vet',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ─── Pets ─────────────────────────────────────────────────────────────────────

export const mockPet = (overrides: Partial<Pet> = {}): Pet => ({
  id: 'pet-001',
  name: 'Buddy',
  species: 'dog',
  breed: 'Golden Retriever',
  dateOfBirth: '2020-03-15',
  ownerId: 'user-001',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

export const mockCatPet = (overrides: Partial<Pet> = {}): Pet => ({
  id: 'pet-002',
  name: 'Whiskers',
  species: 'cat',
  breed: 'Siamese',
  dateOfBirth: '2021-06-10',
  ownerId: 'user-001',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ─── Medical Records ──────────────────────────────────────────────────────────

export const mockMedicalRecord = (overrides: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: 'record-001',
  petId: 'pet-001',
  vetId: 'vet-001',
  recordType: 'checkup',
  date: '2024-06-01T10:00:00.000Z',
  diagnosis: { diagnosisText: 'Healthy, no issues found' },
  notes: 'Annual wellness exam. All vitals normal.',
  createdAt: '2024-06-01T10:00:00.000Z',
  updatedAt: '2024-06-01T10:00:00.000Z',
  ...overrides,
});

export const mockVaccinationRecord = (overrides: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: 'record-002',
  petId: 'pet-001',
  vetId: 'vet-001',
  recordType: 'vaccination',
  date: '2024-06-01T10:30:00.000Z',
  vaccinations: [
    {
      vaccineName: 'Rabies',
      administeredAt: '2024-06-01T10:30:00.000Z',
      nextDueDate: '2025-06-01',
      manufacturer: 'Merial',
      batchNumber: 'RB-2024-001',
    },
  ],
  notes: 'Annual rabies booster administered.',
  createdAt: '2024-06-01T10:30:00.000Z',
  updatedAt: '2024-06-01T10:30:00.000Z',
  ...overrides,
});

// ─── Appointments ─────────────────────────────────────────────────────────────

export const mockAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appt-001',
  petId: 'pet-001',
  vetId: 'vet-001',
  date: '2024-07-15',
  time: '09:00',
  durationMinutes: 30,
  type: AppointmentType.ROUTINE_CHECKUP,
  status: AppointmentStatus.CONFIRMED,
  notes: 'Annual wellness check',
  vet: {
    vetId: 'vet-001',
    name: 'Dr. Alice Smith',
    specialization: 'General Practice',
    clinicName: 'Happy Paws Veterinary Clinic',
    clinicPhone: '+1-555-0200',
    clinicAddress: '123 Main St, Springfield, IL 62701',
  },
  pet: {
    petId: 'pet-001',
    name: 'Buddy',
    species: 'dog',
    breed: 'Golden Retriever',
    age: 4,
  },
  reminder: {
    isEnabled: true,
    minutesBefore: 60,
    notificationMethod: 'push',
  },
  createdAt: '2024-06-01T00:00:00.000Z',
  updatedAt: '2024-06-01T00:00:00.000Z',
  ...overrides,
});

export const mockPendingAppointment = (overrides: Partial<Appointment> = {}): Appointment =>
  mockAppointment({
    id: 'appt-002',
    status: AppointmentStatus.PENDING,
    type: AppointmentType.VACCINATION,
    date: '2024-08-20',
    time: '14:00',
    notes: 'Annual vaccination',
    ...overrides,
  });
