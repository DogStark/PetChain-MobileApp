// @ts-nocheck
import { query, closePool } from '../../src/db';
import { buildSeedSummary, resolveSeedConfig, seed } from '../seedData';

describe('Seed Data', () => {
  describe('preset resolution', () => {
    it('resolves the minimal preset for lightweight testing', () => {
      expect(resolveSeedConfig({ preset: 'minimal' })).toMatchObject({
        numOwners: 2,
        numVets: 1,
        petsPerOwner: 1,
        recordsPerPet: 1,
        appointmentsPerPet: 1,
        medicationsPerPet: 1,
      });
    });

    it('resolves the standard preset for development usage', () => {
      expect(resolveSeedConfig({ preset: 'standard' }).numOwners).toBeGreaterThanOrEqual(4);
      expect(resolveSeedConfig({ preset: 'standard' }).petsPerOwner).toBeGreaterThanOrEqual(2);
    });

    it('resolves the large preset for load testing', () => {
      expect(resolveSeedConfig({ preset: 'large' }).numOwners).toBeGreaterThanOrEqual(10);
      expect(resolveSeedConfig({ preset: 'large' }).recordsPerPet).toBeGreaterThanOrEqual(3);
    });

    it('builds a deterministic summary for seeded records', () => {
      const config = resolveSeedConfig({ preset: 'minimal' });

      expect(buildSeedSummary(config)).toEqual({
        owners: 2,
        vets: 1,
        pets: 2,
        medicalRecords: 2,
        appointments: 2,
        medications: 2,
      });
    });
  });

  beforeAll(async () => {
    // Ensure database is available
    if (!process.env.DATABASE_URL) {
      console.warn('DATABASE_URL not set, skipping seed tests');
      return;
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('should run seed with default configuration', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    await seed({
      numOwners: 2,
      numVets: 1,
      petsPerOwner: 1,
      recordsPerPet: 1,
      appointmentsPerPet: 1,
      medicationsPerPet: 1,
    });

    // Verify users were created
    const usersResult = await query('SELECT COUNT(*) as count FROM users');
    expect(usersResult.rows[0].count).toBeGreaterThanOrEqual(3); // 2 owners + 1 vet

    // Verify pets were created
    const petsResult = await query('SELECT COUNT(*) as count FROM pets');
    expect(petsResult.rows[0].count).toBeGreaterThanOrEqual(2);

    // Verify medical records were created
    const recordsResult = await query('SELECT COUNT(*) as count FROM medical_records');
    expect(recordsResult.rows[0].count).toBeGreaterThanOrEqual(2);

    // Verify appointments were created
    const appointmentsResult = await query('SELECT COUNT(*) as count FROM appointments');
    expect(appointmentsResult.rows[0].count).toBeGreaterThanOrEqual(2);

    // Verify medications were created
    const medicationsResult = await query('SELECT COUNT(*) as count FROM medications');
    expect(medicationsResult.rows[0].count).toBeGreaterThanOrEqual(2);
  });

  it('should create users with correct roles', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    const ownersResult = await query("SELECT COUNT(*) as count FROM users WHERE role = 'owner'");
    const vetsResult = await query("SELECT COUNT(*) as count FROM users WHERE role = 'vet'");

    expect(ownersResult.rows[0].count).toBeGreaterThan(0);
    expect(vetsResult.rows[0].count).toBeGreaterThan(0);
  });

  it('should create pets with valid species', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    const validSpecies = ['dog', 'cat', 'rabbit', 'bird'];
    const petsResult = await query('SELECT DISTINCT species FROM pets');

    petsResult.rows.forEach((row) => {
      expect(validSpecies).toContain(row.species);
    });
  });

  it('should create medical records with valid types', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    const validTypes = ['checkup', 'vaccination', 'surgery', 'treatment', 'other'];
    const recordsResult = await query('SELECT DISTINCT type FROM medical_records');

    recordsResult.rows.forEach((row) => {
      expect(validTypes).toContain(row.type);
    });
  });

  it('should create appointments with valid statuses', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    const validStatuses = [
      'PENDING',
      'CONFIRMED',
      'CANCELLED',
      'COMPLETED',
      'NO_SHOW',
      'RESCHEDULED',
    ];
    const appointmentsResult = await query('SELECT DISTINCT status FROM appointments');

    appointmentsResult.rows.forEach((row) => {
      expect(validStatuses).toContain(row.status);
    });
  });

  it('should create medications with valid statuses', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    const validStatuses = ['active', 'paused', 'completed', 'discontinued'];
    const medicationsResult = await query('SELECT DISTINCT status FROM medications');

    medicationsResult.rows.forEach((row) => {
      expect(validStatuses).toContain(row.status);
    });
  });

  it('should maintain referential integrity', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    // Verify all pets have valid owner_id references
    const orphanPetsResult = await query(
      'SELECT COUNT(*) as count FROM pets WHERE owner_id NOT IN (SELECT id FROM users)',
    );
    expect(orphanPetsResult.rows[0].count).toBe(0);

    // Verify all medical records have valid pet_id and vet_id references
    const orphanRecordsResult = await query(
      'SELECT COUNT(*) as count FROM medical_records WHERE pet_id NOT IN (SELECT id FROM pets) OR vet_id NOT IN (SELECT id FROM users)',
    );
    expect(orphanRecordsResult.rows[0].count).toBe(0);

    // Verify all appointments have valid pet_id and vet_id references
    const orphanAppointmentsResult = await query(
      'SELECT COUNT(*) as count FROM appointments WHERE pet_id NOT IN (SELECT id FROM pets) OR vet_id NOT IN (SELECT id FROM users)',
    );
    expect(orphanAppointmentsResult.rows[0].count).toBe(0);

    // Verify all medications have valid pet_id references
    const orphanMedicationsResult = await query(
      'SELECT COUNT(*) as count FROM medications WHERE pet_id NOT IN (SELECT id FROM pets)',
    );
    expect(orphanMedicationsResult.rows[0].count).toBe(0);
  });

  it('should create data with valid timestamps', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    const usersResult = await query('SELECT created_at, updated_at FROM users LIMIT 1');
    const user = usersResult.rows[0];

    expect(user.created_at).toBeDefined();
    expect(user.updated_at).toBeDefined();
    expect(new Date(user.created_at)).toBeInstanceOf(Date);
    expect(new Date(user.updated_at)).toBeInstanceOf(Date);
  });

  it('should handle custom configuration', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping test: DATABASE_URL not set');
      return;
    }

    const initialUsersResult = await query('SELECT COUNT(*) as count FROM users');
    const initialCount = initialUsersResult.rows[0].count;

    await seed({
      numOwners: 1,
      numVets: 0,
      petsPerOwner: 1,
      recordsPerPet: 0,
      appointmentsPerPet: 0,
      medicationsPerPet: 0,
    });

    const finalUsersResult = await query('SELECT COUNT(*) as count FROM users');
    const finalCount = finalUsersResult.rows[0].count;

    expect(finalCount).toBeGreaterThan(initialCount);
  });
});
