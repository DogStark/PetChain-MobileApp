import { GraphQLError } from 'graphql';
import { PubSub } from 'graphql-subscriptions';
import { v4 as uuidv4 } from 'uuid';

import { query } from '../db';
import { type GraphQLContext } from './context';
import {
  type Resolvers,
  type User,
  type Pet,
  type MedicalRecord,
  type Medication,
  type Appointment,
  type SosAlert,
} from './generated';

export const pubsub = new PubSub();

const SOS_ALERT = 'SOS_ALERT';
const SYNC_STATUS = 'SYNC_STATUS';

function requireAuth(ctx: GraphQLContext): NonNullable<GraphQLContext['user']> {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHORIZED' } });
  return ctx.user;
}

function dbUserToGql(u: any): User {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone ?? null,
    role: u.role,
    pets: [],
    createdAt: u.created_at?.toISOString?.() ?? u.created_at,
    updatedAt: u.updated_at?.toISOString?.() ?? u.updated_at,
    isEmailVerified: u.is_email_verified ?? false,
    lastLoginAt: u.last_login_at?.toISOString?.() ?? u.last_login_at ?? null,
  };
}

function dbPetToGql(p: any): Pet {
  return {
    id: p.id,
    name: p.name,
    species: p.species,
    breed: p.breed ?? null,
    dateOfBirth: p.date_of_birth?.toISOString?.() ?? p.date_of_birth ?? null,
    microchipId: p.microchip_id ?? null,
    photoUrl: p.photo_url ?? null,
    ownerId: p.owner_id,
    owner: null,
    medicalRecords: [],
    medications: [],
    appointments: [],
    createdAt: p.created_at?.toISOString?.() ?? p.created_at,
    updatedAt: p.updated_at?.toISOString?.() ?? p.updated_at,
  };
}

function dbRecordToGql(r: any): MedicalRecord {
  return {
    id: r.id,
    petId: r.pet_id,
    vetId: r.vet_id,
    pet: null,
    vet: null,
    type: r.type,
    diagnosis: r.diagnosis ?? null,
    treatment: r.treatment ?? null,
    notes: r.notes ?? null,
    visitDate: r.visit_date?.toISOString?.() ?? r.visit_date,
    nextVisitDate: r.next_visit_date?.toISOString?.() ?? r.next_visit_date ?? null,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at,
  };
}

function dbMedToGql(m: any): Medication {
  return {
    id: m.id,
    petId: m.pet_id,
    pet: null,
    name: m.name,
    dosage: m.dosage,
    frequency: m.frequency,
    durationDays: m.duration_days,
    startDate: m.start_date?.toISOString?.() ?? m.start_date,
    endDate: m.end_date?.toISOString?.() ?? m.end_date ?? null,
    status: m.status,
    instructions: m.instructions ?? null,
    createdAt: m.created_at?.toISOString?.() ?? m.created_at,
    updatedAt: m.updated_at?.toISOString?.() ?? m.updated_at,
  };
}

function dbApptToGql(a: any): Appointment {
  return {
    id: a.id,
    petId: a.pet_id,
    vetId: a.vet_id,
    pet: null,
    vet: null,
    date: a.date,
    time: a.time,
    durationMinutes: a.duration_minutes ?? null,
    type: a.type,
    status: a.status,
    notes: a.notes ?? null,
    createdAt: a.created_at?.toISOString?.() ?? a.created_at,
    updatedAt: a.updated_at?.toISOString?.() ?? a.updated_at,
  };
}

export const resolvers: Resolvers<GraphQLContext> = {
  Query: {
    me: async (_parent, _args, ctx) => {
      const user = requireAuth(ctx);
      const dbUser = await ctx.loaders.userById.load(user.id);
      if (!dbUser) throw new GraphQLError('User not found', { extensions: { code: 'NOT_FOUND' } });
      return dbUserToGql(dbUser);
    },

    user: async (_parent, { id }, ctx) => {
      requireAuth(ctx);
      const dbUser = await ctx.loaders.userById.load(id);
      return dbUser ? dbUserToGql(dbUser) : null;
    },

    users: async (_parent, _args, ctx) => {
      requireAuth(ctx);
      const res = await query('SELECT * FROM users ORDER BY created_at DESC');
      return res.rows.map(dbUserToGql);
    },

    pet: async (_parent, { id }, ctx) => {
      requireAuth(ctx);
      const dbPet = await ctx.loaders.petById.load(id);
      return dbPet ? dbPetToGql(dbPet) : null;
    },

    myPets: async (_parent, _args, ctx) => {
      const user = requireAuth(ctx);
      const pets = await ctx.loaders.petsByOwner.load(user.id);
      return pets.map(dbPetToGql);
    },

    medicalRecord: async (_parent, { id }, ctx) => {
      requireAuth(ctx);
      const res = await query('SELECT * FROM medical_records WHERE id = $1', [id]);
      return res.rows[0] ? dbRecordToGql(res.rows[0]) : null;
    },

    petMedicalRecords: async (_parent, { petId }, ctx) => {
      requireAuth(ctx);
      const records = await ctx.loaders.medicalRecordsByPet.load(petId);
      return records.map(dbRecordToGql);
    },

    medication: async (_parent, { id }, ctx) => {
      requireAuth(ctx);
      const res = await query('SELECT * FROM medications WHERE id = $1', [id]);
      return res.rows[0] ? dbMedToGql(res.rows[0]) : null;
    },

    petMedications: async (_parent, { petId }, ctx) => {
      requireAuth(ctx);
      const meds = await ctx.loaders.medicationsByPet.load(petId);
      return meds.map(dbMedToGql);
    },

    appointment: async (_parent, { id }, ctx) => {
      requireAuth(ctx);
      const res = await query('SELECT * FROM appointments WHERE id = $1', [id]);
      return res.rows[0] ? dbApptToGql(res.rows[0]) : null;
    },

    petAppointments: async (_parent, { petId }, ctx) => {
      requireAuth(ctx);
      const appts = await ctx.loaders.appointmentsByPet.load(petId);
      return appts.map(dbApptToGql);
    },

    myAppointments: async (_parent, _args, ctx) => {
      const user = requireAuth(ctx);
      const appts = await ctx.loaders.appointmentsByVet.load(user.id);
      return appts.map(dbApptToGql);
    },
  },

  Mutation: {
    createPet: async (_parent, { input }, ctx) => {
      const user = requireAuth(ctx);
      const id = uuidv4();
      const res = await query(
        `INSERT INTO pets (id, name, species, breed, date_of_birth, microchip_id, photo_url, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          id,
          input.name,
          input.species,
          input.breed ?? null,
          input.dateOfBirth ?? null,
          input.microchipId ?? null,
          input.photoUrl ?? null,
          user.id,
        ],
      );
      return dbPetToGql(res.rows[0]);
    },

    updatePet: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx);
      const fields = Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k);
      if (fields.length === 0) {
        const dbPet = await ctx.loaders.petById.load(id);
        if (!dbPet) throw new GraphQLError('Pet not found', { extensions: { code: 'NOT_FOUND' } });
        return dbPetToGql(dbPet);
      }
      const colMap: Record<string, string> = {
        name: 'name',
        species: 'species',
        breed: 'breed',
        dateOfBirth: 'date_of_birth',
        microchipId: 'microchip_id',
        photoUrl: 'photo_url',
      };
      const setClauses = fields.map((f, i) => `${colMap[f]} = $${i + 2}`).join(', ');
      const values = fields.map((f) => (input as any)[f]);
      const res = await query(
        `UPDATE pets SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      if (!res.rows[0])
        throw new GraphQLError('Pet not found', { extensions: { code: 'NOT_FOUND' } });
      ctx.loaders.petById.clear(id);
      return dbPetToGql(res.rows[0]);
    },

    deletePet: async (_parent, { id }, ctx) => {
      requireAuth(ctx);
      const res = await query('DELETE FROM pets WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    },

    createMedicalRecord: async (_parent, { input }, ctx) => {
      requireAuth(ctx);
      const id = uuidv4();
      const res = await query(
        `INSERT INTO medical_records (id, pet_id, vet_id, type, diagnosis, treatment, notes, visit_date, next_visit_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          id,
          input.petId,
          input.vetId,
          input.type,
          input.diagnosis ?? null,
          input.treatment ?? null,
          input.notes ?? null,
          input.visitDate,
          input.nextVisitDate ?? null,
        ],
      );
      ctx.loaders.medicalRecordsByPet.clear(input.petId);
      return dbRecordToGql(res.rows[0]);
    },

    createMedication: async (_parent, { input }, ctx) => {
      requireAuth(ctx);
      const id = uuidv4();
      const res = await query(
        `INSERT INTO medications (id, pet_id, name, dosage, frequency, duration_days, start_date, end_date, status, instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          id,
          input.petId,
          input.name,
          input.dosage,
          input.frequency,
          input.durationDays,
          input.startDate,
          input.endDate ?? null,
          'active',
          input.instructions ?? null,
        ],
      );
      ctx.loaders.medicationsByPet.clear(input.petId);
      return dbMedToGql(res.rows[0]);
    },

    updateMedication: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx);
      const fields = Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k);
      if (fields.length === 0) {
        const res = await query('SELECT * FROM medications WHERE id = $1', [id]);
        if (!res.rows[0])
          throw new GraphQLError('Medication not found', { extensions: { code: 'NOT_FOUND' } });
        return dbMedToGql(res.rows[0]);
      }
      const colMap: Record<string, string> = {
        name: 'name',
        dosage: 'dosage',
        frequency: 'frequency',
        durationDays: 'duration_days',
        startDate: 'start_date',
        endDate: 'end_date',
        status: 'status',
        instructions: 'instructions',
      };
      const setClauses = fields.map((f, i) => `${colMap[f]} = $${i + 2}`).join(', ');
      const values = fields.map((f) => (input as any)[f]);
      const res = await query(
        `UPDATE medications SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      if (!res.rows[0])
        throw new GraphQLError('Medication not found', { extensions: { code: 'NOT_FOUND' } });
      ctx.loaders.medicationsByPet.clear(res.rows[0].pet_id);
      return dbMedToGql(res.rows[0]);
    },

    createAppointment: async (_parent, { input }, ctx) => {
      requireAuth(ctx);
      const id = uuidv4();
      const res = await query(
        `INSERT INTO appointments (id, pet_id, vet_id, date, time, duration_minutes, type, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          id,
          input.petId,
          input.vetId,
          input.date,
          input.time,
          input.durationMinutes ?? 30,
          input.type,
          'PENDING',
          input.notes ?? null,
        ],
      );
      ctx.loaders.appointmentsByPet.clear(input.petId);
      ctx.loaders.appointmentsByVet.clear(input.vetId);
      return dbApptToGql(res.rows[0]);
    },

    updateAppointment: async (_parent, { id, input }, ctx) => {
      requireAuth(ctx);
      const fields = Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k);
      if (fields.length === 0) {
        const res = await query('SELECT * FROM appointments WHERE id = $1', [id]);
        if (!res.rows[0])
          throw new GraphQLError('Appointment not found', { extensions: { code: 'NOT_FOUND' } });
        return dbApptToGql(res.rows[0]);
      }
      const colMap: Record<string, string> = {
        date: 'date',
        time: 'time',
        durationMinutes: 'duration_minutes',
        type: 'type',
        status: 'status',
        notes: 'notes',
      };
      const setClauses = fields.map((f, i) => `${colMap[f]} = $${i + 2}`).join(', ');
      const values = fields.map((f) => (input as any)[f]);
      const res = await query(
        `UPDATE appointments SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      if (!res.rows[0])
        throw new GraphQLError('Appointment not found', { extensions: { code: 'NOT_FOUND' } });
      ctx.loaders.appointmentsByPet.clear(res.rows[0].pet_id);
      ctx.loaders.appointmentsByVet.clear(res.rows[0].vet_id);
      return dbApptToGql(res.rows[0]);
    },

    triggerSos: async (_parent, { input }, ctx) => {
      const user = requireAuth(ctx);
      const alert: SosAlert = {
        id: uuidv4(),
        userId: user.id,
        petId: input.petId ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        message: input.message,
        triggeredAt: new Date().toISOString(),
      };
      await pubsub.publish(SOS_ALERT, { sosAlert: alert });
      return alert;
    },
  },

  Subscription: {
    sosAlert: {
      subscribe: (_parent, _args, ctx) => {
        requireAuth(ctx);
        return pubsub.asyncIterator(SOS_ALERT) as unknown as AsyncIterable<unknown>;
      },
      resolve: (payload: { sosAlert: unknown }) => payload.sosAlert,
    },
    syncStatus: {
      subscribe: (_parent, _args, ctx) => {
        requireAuth(ctx);
        return pubsub.asyncIterator(SYNC_STATUS) as unknown as AsyncIterable<unknown>;
      },
      resolve: (payload: { syncStatus: unknown }) => payload.syncStatus,
    },
  } as any,

  // Field resolvers — use DataLoaders to avoid N+1
  User: {
    pets: async (parent, _args, ctx) => {
      const pets = await ctx.loaders.petsByOwner.load(parent.id);
      return pets.map(dbPetToGql);
    },
  },

  Pet: {
    owner: async (parent, _args, ctx) => {
      const dbUser = await ctx.loaders.userById.load(parent.ownerId);
      return dbUser ? dbUserToGql(dbUser) : null;
    },
    medicalRecords: async (parent, _args, ctx) => {
      const records = await ctx.loaders.medicalRecordsByPet.load(parent.id);
      return records.map(dbRecordToGql);
    },
    medications: async (parent, _args, ctx) => {
      const meds = await ctx.loaders.medicationsByPet.load(parent.id);
      return meds.map(dbMedToGql);
    },
    appointments: async (parent, _args, ctx) => {
      const appts = await ctx.loaders.appointmentsByPet.load(parent.id);
      return appts.map(dbApptToGql);
    },
  },

  MedicalRecord: {
    pet: async (parent, _args, ctx) => {
      const dbPet = await ctx.loaders.petById.load(parent.petId);
      return dbPet ? dbPetToGql(dbPet) : null;
    },
    vet: async (parent, _args, ctx) => {
      const dbUser = await ctx.loaders.userById.load(parent.vetId);
      return dbUser ? dbUserToGql(dbUser) : null;
    },
  },

  Medication: {
    pet: async (parent, _args, ctx) => {
      const dbPet = await ctx.loaders.petById.load(parent.petId);
      return dbPet ? dbPetToGql(dbPet) : null;
    },
  },

  Appointment: {
    pet: async (parent, _args, ctx) => {
      const dbPet = await ctx.loaders.petById.load(parent.petId);
      return dbPet ? dbPetToGql(dbPet) : null;
    },
    vet: async (parent, _args, ctx) => {
      const dbUser = await ctx.loaders.userById.load(parent.vetId);
      return dbUser ? dbUserToGql(dbUser) : null;
    },
  },
};

export { SOS_ALERT, SYNC_STATUS };
