import DataLoader from 'dataloader';
import { GraphQLError } from 'graphql';

// ── Mock DB query ──────────────────────────────────────────────────────────────
jest.mock('../../db', () => ({ query: jest.fn() }));
import { UserRole } from '../../../models/UserRole';
import { query } from '../../db';
import { type GraphQLContext } from '../context';
import { resolvers, pubsub, SOS_ALERT } from '../resolvers';
const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Helpers ────────────────────────────────────────────────────────────────────

const NOW = '2024-01-01T00:00:00.000Z';

const mockUser = {
  id: 'user-1',
  email: 'owner@test.com',
  name: 'Test Owner',
  phone: null,
  role: UserRole.OWNER,
  is_email_verified: true,
  last_login_at: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const mockPet = {
  id: 'pet-1',
  name: 'Buddy',
  species: 'dog',
  breed: 'Labrador',
  date_of_birth: null,
  microchip_id: null,
  photo_url: null,
  owner_id: 'user-1',
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const mockRecord = {
  id: 'record-1',
  pet_id: 'pet-1',
  vet_id: 'user-2',
  type: 'checkup',
  diagnosis: 'Healthy',
  treatment: null,
  notes: null,
  visit_date: new Date(NOW),
  next_visit_date: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const mockMedication = {
  id: 'med-1',
  pet_id: 'pet-1',
  name: 'Amoxicillin',
  dosage: '250mg',
  frequency: 'twice_daily',
  duration_days: 7,
  start_date: new Date(NOW),
  end_date: null,
  status: 'active',
  instructions: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const mockAppointment = {
  id: 'appt-1',
  pet_id: 'pet-1',
  vet_id: 'user-2',
  date: '2024-06-01',
  time: '10:00',
  duration_minutes: 30,
  type: 'ROUTINE_CHECKUP',
  status: 'PENDING',
  notes: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

function makeLoaders(
  overrides: Partial<GraphQLContext['loaders']> = {},
): GraphQLContext['loaders'] {
  return {
    userById: new DataLoader(async (ids) => ids.map(() => mockUser)) as any,
    petById: new DataLoader(async (ids) => ids.map(() => mockPet)) as any,
    petsByOwner: new DataLoader(async (ids) => ids.map(() => [mockPet])) as any,
    medicalRecordsByPet: new DataLoader(async (ids) => ids.map(() => [mockRecord])) as any,
    medicationsByPet: new DataLoader(async (ids) => ids.map(() => [mockMedication])) as any,
    appointmentsByPet: new DataLoader(async (ids) => ids.map(() => [mockAppointment])) as any,
    appointmentsByVet: new DataLoader(async (ids) => ids.map(() => [mockAppointment])) as any,
    ...overrides,
  };
}

function makeCtx(userOverride?: Partial<GraphQLContext['user']>): GraphQLContext {
  const user =
    userOverride === null
      ? null
      : { id: 'user-1', email: 'owner@test.com', role: UserRole.OWNER, ...userOverride };
  return { user, loaders: makeLoaders() };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GraphQL Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Auth guard ─────────────────────────────────────────────────────────────

  describe('requireAuth', () => {
    it('throws UNAUTHORIZED when no user in context', async () => {
      const ctx = makeCtx();
      ctx.user = null;
      await expect((resolvers.Query!.me as Function)(null, {}, ctx, {} as any)).rejects.toThrow(
        GraphQLError,
      );
    });
  });

  // ── Query.me ──────────────────────────────────────────────────────────────

  describe('Query.me', () => {
    it('returns the authenticated user', async () => {
      const ctx = makeCtx();
      const result = await (resolvers.Query!.me as Function)(null, {}, ctx, {} as any);
      expect(result.id).toBe('user-1');
      expect(result.email).toBe('owner@test.com');
    });

    it('throws NOT_FOUND when user not in DB', async () => {
      const ctx = makeCtx();
      ctx.loaders.userById = new DataLoader(async (ids) => ids.map(() => null)) as any;
      await expect((resolvers.Query!.me as Function)(null, {}, ctx, {} as any)).rejects.toThrow(
        GraphQLError,
      );
    });
  });

  // ── Query.myPets ──────────────────────────────────────────────────────────

  describe('Query.myPets', () => {
    it('returns pets for authenticated user via DataLoader', async () => {
      const ctx = makeCtx();
      const result = await (resolvers.Query!.myPets as Function)(null, {}, ctx, {} as any);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('pet-1');
      expect(result[0].name).toBe('Buddy');
    });

    it('returns empty array when user has no pets', async () => {
      const ctx = makeCtx();
      ctx.loaders.petsByOwner = new DataLoader(async (ids) => ids.map(() => [])) as any;
      const result = await (resolvers.Query!.myPets as Function)(null, {}, ctx, {} as any);
      expect(result).toHaveLength(0);
    });
  });

  // ── Query.pet ─────────────────────────────────────────────────────────────

  describe('Query.pet', () => {
    it('returns pet by id via DataLoader', async () => {
      const ctx = makeCtx();
      const result = await (resolvers.Query!.pet as Function)(
        null,
        { id: 'pet-1' },
        ctx,
        {} as any,
      );
      expect(result!.id).toBe('pet-1');
    });

    it('returns null when pet not found', async () => {
      const ctx = makeCtx();
      ctx.loaders.petById = new DataLoader(async (ids) => ids.map(() => null)) as any;
      const result = await (resolvers.Query!.pet as Function)(null, { id: 'x' }, ctx, {} as any);
      expect(result).toBeNull();
    });
  });

  // ── Query.petMedicalRecords ───────────────────────────────────────────────

  describe('Query.petMedicalRecords', () => {
    it('returns records via DataLoader', async () => {
      const ctx = makeCtx();
      const result = await (resolvers.Query!.petMedicalRecords as Function)(
        null,
        { petId: 'pet-1' },
        ctx,
        {} as any,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('record-1');
      expect(result[0].type).toBe('checkup');
    });
  });

  // ── Query.petMedications ──────────────────────────────────────────────────

  describe('Query.petMedications', () => {
    it('returns medications via DataLoader', async () => {
      const ctx = makeCtx();
      const result = await (resolvers.Query!.petMedications as Function)(
        null,
        { petId: 'pet-1' },
        ctx,
        {} as any,
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Amoxicillin');
    });
  });

  // ── Query.petAppointments ─────────────────────────────────────────────────

  describe('Query.petAppointments', () => {
    it('returns appointments via DataLoader', async () => {
      const ctx = makeCtx();
      const result = await (resolvers.Query!.petAppointments as Function)(
        null,
        { petId: 'pet-1' },
        ctx,
        {} as any,
      );
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ROUTINE_CHECKUP');
    });
  });

  // ── Mutation.createPet ────────────────────────────────────────────────────

  describe('Mutation.createPet', () => {
    it('inserts pet and returns it', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [mockPet], rowCount: 1 } as any);
      const ctx = makeCtx();
      const input = { name: 'Buddy', species: 'dog' as const };
      const result = await (resolvers.Mutation!.createPet as Function)(
        null,
        { input },
        ctx,
        {} as any,
      );
      expect(result.name).toBe('Buddy');
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO pets');
    });

    it('throws UNAUTHORIZED when not authenticated', async () => {
      const ctx = makeCtx();
      ctx.user = null;
      await expect(
        (resolvers.Mutation!.createPet as Function)(
          null,
          { input: { name: 'x', species: 'dog' } },
          ctx,
          {} as any,
        ),
      ).rejects.toThrow(GraphQLError);
    });
  });

  // ── Mutation.deletePet ────────────────────────────────────────────────────

  describe('Mutation.deletePet', () => {
    it('returns true when pet deleted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
      const ctx = makeCtx();
      const result = await (resolvers.Mutation!.deletePet as Function)(
        null,
        { id: 'pet-1' },
        ctx,
        {} as any,
      );
      expect(result).toBe(true);
    });

    it('returns false when pet not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      const ctx = makeCtx();
      const result = await (resolvers.Mutation!.deletePet as Function)(
        null,
        { id: 'missing' },
        ctx,
        {} as any,
      );
      expect(result).toBe(false);
    });
  });

  // ── Mutation.createMedicalRecord ──────────────────────────────────────────

  describe('Mutation.createMedicalRecord', () => {
    it('inserts record and clears DataLoader cache', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [mockRecord], rowCount: 1 } as any);
      const ctx = makeCtx();
      const clearSpy = jest.spyOn(ctx.loaders.medicalRecordsByPet, 'clear');
      const input = {
        petId: 'pet-1',
        vetId: 'user-2',
        type: 'checkup' as const,
        visitDate: NOW,
      };
      const result = await (resolvers.Mutation!.createMedicalRecord as Function)(
        null,
        { input },
        ctx,
        {} as any,
      );
      expect(result.id).toBe('record-1');
      expect(clearSpy).toHaveBeenCalledWith('pet-1');
    });
  });

  // ── Mutation.createMedication ─────────────────────────────────────────────

  describe('Mutation.createMedication', () => {
    it('inserts medication and clears DataLoader cache', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [mockMedication], rowCount: 1 } as any);
      const ctx = makeCtx();
      const clearSpy = jest.spyOn(ctx.loaders.medicationsByPet, 'clear');
      const input = {
        petId: 'pet-1',
        name: 'Amoxicillin',
        dosage: '250mg',
        frequency: 'twice_daily' as const,
        durationDays: 7,
        startDate: NOW,
      };
      const result = await (resolvers.Mutation!.createMedication as Function)(
        null,
        { input },
        ctx,
        {} as any,
      );
      expect(result.name).toBe('Amoxicillin');
      expect(clearSpy).toHaveBeenCalledWith('pet-1');
    });
  });

  // ── Mutation.createAppointment ────────────────────────────────────────────

  describe('Mutation.createAppointment', () => {
    it('inserts appointment and clears both DataLoader caches', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [mockAppointment], rowCount: 1 } as any);
      const ctx = makeCtx();
      const clearPet = jest.spyOn(ctx.loaders.appointmentsByPet, 'clear');
      const clearVet = jest.spyOn(ctx.loaders.appointmentsByVet, 'clear');
      const input = {
        petId: 'pet-1',
        vetId: 'user-2',
        date: '2024-06-01',
        time: '10:00',
        type: 'ROUTINE_CHECKUP' as const,
      };
      const result = await (resolvers.Mutation!.createAppointment as Function)(
        null,
        { input },
        ctx,
        {} as any,
      );
      expect(result.status).toBe('PENDING');
      expect(clearPet).toHaveBeenCalledWith('pet-1');
      expect(clearVet).toHaveBeenCalledWith('user-2');
    });
  });

  // ── Mutation.triggerSos ───────────────────────────────────────────────────

  describe('Mutation.triggerSos', () => {
    it('publishes SOS_ALERT and returns alert', async () => {
      const publishSpy = jest.spyOn(pubsub, 'publish');
      const ctx = makeCtx();
      const input = { message: 'Emergency!', latitude: 1.0, longitude: 2.0 };
      const result = await (resolvers.Mutation!.triggerSos as Function)(
        null,
        { input },
        ctx,
        {} as any,
      );
      expect(result.message).toBe('Emergency!');
      expect(result.userId).toBe('user-1');
      expect(publishSpy).toHaveBeenCalledWith(SOS_ALERT, { sosAlert: result });
    });

    it('throws UNAUTHORIZED when not authenticated', async () => {
      const ctx = makeCtx();
      ctx.user = null;
      await expect(
        (resolvers.Mutation!.triggerSos as Function)(
          null,
          { input: { message: 'x' } },
          ctx,
          {} as any,
        ),
      ).rejects.toThrow(GraphQLError);
    });
  });

  // ── Subscription ──────────────────────────────────────────────────────────

  describe('Subscription.sosAlert', () => {
    it('returns an async iterator when authenticated', () => {
      const ctx = makeCtx();
      const sub = (resolvers.Subscription!.sosAlert as any).subscribe(null, {}, ctx, {} as any);
      expect(sub).toBeDefined();
      expect(typeof sub[Symbol.asyncIterator]).toBe('function');
    });

    it('throws UNAUTHORIZED when not authenticated', () => {
      const ctx = makeCtx();
      ctx.user = null;
      expect(() =>
        (resolvers.Subscription!.sosAlert as any).subscribe(null, {}, ctx, {} as any),
      ).toThrow(GraphQLError);
    });
  });

  describe('Subscription.syncStatus', () => {
    it('returns an async iterator when authenticated', () => {
      const ctx = makeCtx();
      const sub = (resolvers.Subscription!.syncStatus as any).subscribe(null, {}, ctx, {} as any);
      expect(sub).toBeDefined();
      expect(typeof sub[Symbol.asyncIterator]).toBe('function');
    });
  });

  // ── Field resolvers (DataLoader coverage) ─────────────────────────────────

  describe('Pet field resolvers', () => {
    it('Pet.owner loads user via DataLoader', async () => {
      const ctx = makeCtx();
      const loadSpy = jest.spyOn(ctx.loaders.userById, 'load');
      const parent = { id: 'pet-1', ownerId: 'user-1' } as any;
      const result = await (resolvers.Pet!.owner as Function)(parent, {}, ctx, {} as any);
      expect(loadSpy).toHaveBeenCalledWith('user-1');
      expect(result!.id).toBe('user-1');
    });

    it('Pet.medicalRecords loads via DataLoader', async () => {
      const ctx = makeCtx();
      const loadSpy = jest.spyOn(ctx.loaders.medicalRecordsByPet, 'load');
      const parent = { id: 'pet-1' } as any;
      const result = await (resolvers.Pet!.medicalRecords as Function)(parent, {}, ctx, {} as any);
      expect(loadSpy).toHaveBeenCalledWith('pet-1');
      expect(result).toHaveLength(1);
    });

    it('Pet.medications loads via DataLoader', async () => {
      const ctx = makeCtx();
      const loadSpy = jest.spyOn(ctx.loaders.medicationsByPet, 'load');
      const parent = { id: 'pet-1' } as any;
      await (resolvers.Pet!.medications as Function)(parent, {}, ctx, {} as any);
      expect(loadSpy).toHaveBeenCalledWith('pet-1');
    });

    it('Pet.appointments loads via DataLoader', async () => {
      const ctx = makeCtx();
      const loadSpy = jest.spyOn(ctx.loaders.appointmentsByPet, 'load');
      const parent = { id: 'pet-1' } as any;
      await (resolvers.Pet!.appointments as Function)(parent, {}, ctx, {} as any);
      expect(loadSpy).toHaveBeenCalledWith('pet-1');
    });
  });

  describe('MedicalRecord field resolvers', () => {
    it('MedicalRecord.vet loads user via DataLoader', async () => {
      const ctx = makeCtx();
      const loadSpy = jest.spyOn(ctx.loaders.userById, 'load');
      const parent = { petId: 'pet-1', vetId: 'user-2' } as any;
      await (resolvers.MedicalRecord!.vet as Function)(parent, {}, ctx, {} as any);
      expect(loadSpy).toHaveBeenCalledWith('user-2');
    });
  });

  describe('Appointment field resolvers', () => {
    it('Appointment.vet loads user via DataLoader', async () => {
      const ctx = makeCtx();
      const loadSpy = jest.spyOn(ctx.loaders.userById, 'load');
      const parent = { petId: 'pet-1', vetId: 'user-2' } as any;
      await (resolvers.Appointment!.vet as Function)(parent, {}, ctx, {} as any);
      expect(loadSpy).toHaveBeenCalledWith('user-2');
    });
  });

  // ── DataLoader batching ───────────────────────────────────────────────────

  describe('DataLoader batching', () => {
    it('batches multiple userById loads into a single call', async () => {
      const batchFn = jest.fn(async (ids: readonly string[]) => ids.map(() => mockUser));
      const loader = new DataLoader(batchFn);
      // Load multiple IDs in the same tick
      const [a, b] = await Promise.all([loader.load('u1'), loader.load('u2')]);
      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(batchFn.mock.calls[0][0]).toEqual(['u1', 'u2']);
      expect(a).toEqual(mockUser);
      expect(b).toEqual(mockUser);
    });

    it('caches repeated loads within the same request', async () => {
      const batchFn = jest.fn(async (ids: readonly string[]) => ids.map(() => mockUser));
      const loader = new DataLoader(batchFn);
      await loader.load('u1');
      await loader.load('u1');
      expect(batchFn).toHaveBeenCalledTimes(1);
    });
  });
});
