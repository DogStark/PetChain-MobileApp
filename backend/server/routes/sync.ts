import express from 'express';

import { authenticateJWT } from '../../middleware/auth';
import { ok, sendError } from '../response';
import { store } from '../store';

export type ConflictResolutionStrategy = 'last-write-wins' | 'server-wins' | 'client-wins';

type EntityType = 'pet' | 'appointment' | 'medication' | 'medicalRecord';
type SyncAction = 'create' | 'update' | 'delete';

interface SyncRecord {
  id: string;
  entityType: EntityType;
  entityId: string;
  action: SyncAction;
  payload: Record<string, unknown>;
  updatedAt: string;
  syncVersion: number;
}

const router = express.Router();

router.use(authenticateJWT);

router.post('/push', (req, res) => {
  const { records, strategy = 'last-write-wins' } = req.body as {
    records?: SyncRecord[];
    strategy?: ConflictResolutionStrategy;
  };

  if (!Array.isArray(records)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'records must be an array');
  }

  const results = records.map((record) => {
    try {
      const result = applyRecord(record, strategy);
      return { id: record.id, entityId: record.entityId, ...result };
    } catch (error) {
      return {
        id: record.id,
        entityId: record.entityId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown sync failure',
      };
    }
  });

  return res.json(ok({ results }));
});

router.get('/pull', (req, res) => {
  const since = typeof req.query.since === 'string' ? Date.parse(req.query.since) : 0;
  const changedSince = (value?: string) => !since || Date.parse(value ?? '') > since;

  return res.json(
    ok({
      pets: [...store.pets.values()].filter((item) => changedSince(item.updatedAt)),
      medicalRecords: [...store.medicalRecords.values()].filter((item) =>
        changedSince(item.updatedAt),
      ),
      appointments: [...store.appointments.values()].filter((item) => changedSince(item.updatedAt)),
      medications: [...store.medications.values()],
      serverTime: new Date().toISOString(),
    }),
  );
});

function applyRecord(record: SyncRecord, strategy: ConflictResolutionStrategy) {
  const collection = getCollection(record.entityType);
  const existing = collection.get(record.entityId) as Record<string, unknown> | undefined;

  if (record.action === 'delete') {
    collection.delete(record.entityId);
    return { status: 'deleted' };
  }

  if (!existing) {
    collection.set(record.entityId, normalizePayload(record));
    return { status: 'created', serverRecord: collection.get(record.entityId) };
  }

  const merged = resolveConflict(record.payload, existing, strategy);
  collection.set(record.entityId, {
    ...existing,
    ...merged,
    id: record.entityId,
    updatedAt: new Date().toISOString(),
  });

  const hadConflict = Date.parse(String(existing.updatedAt ?? 0)) > Date.parse(record.updatedAt);
  return {
    status: hadConflict ? 'conflict' : 'updated',
    serverRecord: collection.get(record.entityId),
  };
}

function normalizePayload(record: SyncRecord): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    ...record.payload,
    id: record.entityId,
    createdAt: String(record.payload.createdAt ?? now),
    updatedAt: now,
  };
}

function resolveConflict(
  client: Record<string, unknown>,
  server: Record<string, unknown>,
  strategy: ConflictResolutionStrategy,
): Record<string, unknown> {
  if (strategy === 'server-wins') return server;
  if (strategy === 'client-wins') return client;

  const clientTime = Date.parse(String(client.updated_at ?? client.updatedAt ?? 0));
  const serverTime = Date.parse(String(server.updated_at ?? server.updatedAt ?? 0));
  const winner = clientTime >= serverTime ? client : server;
  const loser = clientTime >= serverTime ? server : client;
  return { ...loser, ...winner };
}

function getCollection(entityType: EntityType): Map<string, unknown> {
  if (entityType === 'pet') return store.pets as unknown as Map<string, unknown>;
  if (entityType === 'appointment') return store.appointments as unknown as Map<string, unknown>;
  if (entityType === 'medication') return store.medications as unknown as Map<string, unknown>;
  return store.medicalRecords as unknown as Map<string, unknown>;
}

export default router;
