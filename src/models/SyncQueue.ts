/**
 * Offline-to-online sync queue model.
 *
 * Mutations made while the device is offline are appended to this queue and
 * replayed against the backend once connectivity returns.
 */

/** Mutation kind represented by a queued item. */
export enum SyncOperation {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/** Lifecycle state of a queued item. */
export enum SyncStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

/** Entities that can be synced offline. */
export type SyncEntity =
  | 'pet'
  | 'owner'
  | 'appointment'
  | 'medicalRecord'
  | 'medication'
  | 'healthMetric';

/** Maximum retry attempts before an item is left in `FAILED`. */
export const MAX_SYNC_RETRIES = 5;

/**
 * A single queued mutation waiting to be replayed against the backend.
 */
export interface SyncQueueItem<TPayload = unknown> {
  /** Unique queue item identifier (client-generated) */
  id: string;
  /** Mutation kind */
  operation: SyncOperation;
  /** Entity type the mutation applies to */
  entity: SyncEntity;
  /** Id of the affected record; absent for CREATE until the server responds */
  entityId?: string;
  /** Request body to replay */
  payload: TPayload;
  /** Number of failed attempts so far */
  retries: number;
  /** Current lifecycle state */
  status: SyncStatus;
  /** Message from the most recent failure */
  lastError?: string;
  /** ISO-8601 timestamp of when the item was queued */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent attempt */
  updatedAt?: string;
}

/**
 * Factory for a new queue item — always starts `PENDING` with zero retries.
 */
export const createSyncQueueItem = <TPayload>(
  data: Pick<SyncQueueItem<TPayload>, 'operation' | 'entity' | 'payload'> &
    Partial<SyncQueueItem<TPayload>>,
): SyncQueueItem<TPayload> => ({
  id: data.id || `sync_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  operation: data.operation,
  entity: data.entity,
  entityId: data.entityId,
  payload: data.payload,
  retries: data.retries ?? 0,
  status: data.status ?? SyncStatus.PENDING,
  lastError: data.lastError,
  createdAt: data.createdAt || new Date().toISOString(),
  updatedAt: data.updatedAt,
});

/** Whether an item still has retry budget left. */
export const isRetryable = (item: SyncQueueItem): boolean =>
  item.status !== SyncStatus.COMPLETED && item.retries < MAX_SYNC_RETRIES;
