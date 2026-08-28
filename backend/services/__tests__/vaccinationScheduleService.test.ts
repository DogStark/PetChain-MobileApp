import type { StoredMedicalRecord, StoredPet } from '../../server/store';
import {
  exportVaccinationCertificate,
  generateVaccinationReminders,
  getStandardVaccinationSchedules,
} from '../vaccinationScheduleService';

const basePet: StoredPet = {
  id: 'pet-1',
  name: 'Scout',
  species: 'dog',
  breed: 'Labrador Retriever',
  dateOfBirth: '2026-01-01',
  microchipId: 'ABC123',
  ownerId: 'owner-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const record = (overrides: Partial<StoredMedicalRecord>): StoredMedicalRecord => ({
  id: 'record-1',
  petId: 'pet-1',
  vetId: 'vet-1',
  type: 'vaccination',
  diagnosis: 'DA2PP',
  treatment: 'DA2PP',
  visitDate: '2026-02-12',
  createdAt: '2026-02-12T00:00:00.000Z',
  updatedAt: '2026-02-12T00:00:00.000Z',
  ...overrides,
});

describe('vaccinationScheduleService', () => {
  it('maintains species-specific standard schedules for dogs and cats', () => {
    expect(getStandardVaccinationSchedules('dog').every((entry) => entry.species === 'dog')).toBe(
      true,
    );
    expect(getStandardVaccinationSchedules('cat').every((entry) => entry.species === 'cat')).toBe(
      true,
    );
    expect(getStandardVaccinationSchedules('dog').map((entry) => entry.vaccineName)).toContain(
      'Rabies',
    );
    expect(getStandardVaccinationSchedules('cat').map((entry) => entry.vaccineName)).toContain(
      'FVRCP',
    );
  });

  it('generates due-soon puppy reminders at the six week age range', () => {
    const reminders = generateVaccinationReminders(
      basePet,
      [],
      new Date('2026-02-01T00:00:00.000Z'),
    );
    const da2ppSixWeek = reminders.find((reminder) => reminder.scheduleId === 'dog-da2pp-6w');

    expect(da2ppSixWeek).toMatchObject({
      vaccineName: 'DA2PP',
      dueDate: '2026-02-12',
      status: 'due_soon',
      reminderDates: ['2026-02-05', '2026-02-11'],
    });
  });

  it('marks missed age-range vaccines overdue and recorded vaccines administered', () => {
    const reminders = generateVaccinationReminders(
      basePet,
      [record({ id: 'da2pp-6', visitDate: '2026-02-12' })],
      new Date('2026-04-20T00:00:00.000Z'),
    );

    expect(reminders.find((reminder) => reminder.scheduleId === 'dog-da2pp-6w')?.status).toBe(
      'upcoming',
    );
    expect(reminders.find((reminder) => reminder.scheduleId === 'dog-rabies-16w')).toMatchObject({
      dueDate: '2026-04-23',
      status: 'due_soon',
    });
  });

  it('rolls adult boosters forward from vaccination history with blockchain verification', () => {
    const adultPet = { ...basePet, dateOfBirth: '2020-01-01' };
    const reminders = generateVaccinationReminders(
      adultPet,
      [
        record({
          id: 'rabies-2026',
          diagnosis: 'Rabies',
          treatment: 'Rabies',
          visitDate: '2026-03-01',
          nextVisitDate: '2027-03-01',
          blockchainTxHash: 'tx-123',
          blockchainHash: 'hash-123',
          isBlockchainVerified: true,
        }),
      ],
      new Date('2026-03-10T00:00:00.000Z'),
    );

    const rabies = reminders.find((reminder) => reminder.scheduleId === 'dog-rabies-16w');
    expect(rabies).toMatchObject({
      dueDate: '2027-03-01',
      status: 'upcoming',
      veterinaryVerification: {
        vetId: 'vet-1',
        blockchainTxHash: 'tx-123',
        blockchainHash: 'hash-123',
      },
    });
  });

  it('exports formatted vaccination certificates', () => {
    const certificate = exportVaccinationCertificate(
      basePet,
      [record({ blockchainTxHash: 'tx-abc' })],
      new Date('2026-05-01T00:00:00.000Z'),
    );

    expect(certificate).toContain('PetChain Vaccination Certificate');
    expect(certificate).toContain('Pet: Scout');
    expect(certificate).toContain('2026-02-12 | DA2PP | Vet: vet-1 | Blockchain: tx-abc');
    expect(certificate).toContain('Upcoming Schedule');
  });
});
