import { create } from 'zustand';

/**
 * Subscription event handling for the mobile store.
 *
 * Subscription reconnects or server rollouts can deliver events that are
 * missing optional fields or that use a newer schema. We validate the event
 * envelope before applying it, ignore unsupported records safely, and trigger
 * a bounded, deduplicated refetch when an event cannot be applied.
 */

export type SubscriptionEventType =
  | 'record.created'
  | 'record.updated'
  | 'record.deleted';

export interface SubscriptionEventEnvelope {
  type?: unknown;
  payload?: unknown;
  version?: unknown;
}

export interface RecordPayload {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  updatedAt?: unknown;
}

export interface Record {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

const SUPPORTED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'record.created',
  'record.updated',
  'record.deleted',
]);

// Bounded refetch: at most one refetch per window, deduplicated across events.
const REFETCH_WINDOW_MS = 5000;
let lastRefetchAt = 0;
let refetchTimer: ReturnType<typeof setTimeout> | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the event envelope. Returns the event type when the envelope is
 * well-formed and supported, otherwise null. Never throws.
 */
export function validateEnvelope(
  event: unknown,
): SubscriptionEventType | null {
  if (!isPlainObject(event)) {
    return null;
  }
  const { type } = event as SubscriptionEventEnvelope;
  if (typeof type !== 'string' || !SUPPORTED_EVENT_TYPES.has(type)) {
    return null;
  }
  return type as SubscriptionEventType;
}

/**
 * Extract only the known fields present in a partial payload. Unknown or
 * malformed fields are dropped so a newer schema cannot corrupt the store.
 */
export function pickKnownFields(payload: unknown): Partial<Record> {
  if (!isPlainObject(payload)) {
    return {};
  }
  const source = payload as RecordPayload;
  const result: Partial<Record> = {};
  if (typeof source.id === 'string') {
    result.id = source.id;
  }
  if (typeof source.title === 'string') {
    result.title = source.title;
  }
  if (typeof source.status === 'string') {
    result.status = source.status;
  }
  if (typeof source.updatedAt === 'string') {
    result.updatedAt = source.updatedAt;
  }
  return result;
}

interface SubscriptionState {
  records: Record[];
  refetch: () => void;
  applyEvent: (event: unknown) => void;
}

/**
 * Schedule a bounded refetch. Deduplicated: repeated calls within the window
 * collapse into a single refetch.
 */
function scheduleRefetch(refetch: () => void): void {
  const now = Date.now();
  if (now - lastRefetchAt < REFETCH_WINDOW_MS) {
    return;
  }
  lastRefetchAt = now;
  if (refetchTimer !== null) {
    clearTimeout(refetchTimer);
  }
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    try {
      refetch();
    } catch {
      // A failed refetch must never crash the store.
    }
  }, 0);
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  records: [],

  refetch: () => {
    // Placeholder for the real network refetch; kept safe and non-throwing.
  },

  applyEvent: (event: unknown) => {
    const type = validateEnvelope(event);
    if (type === null) {
      // Unsupported or malformed record: ignore safely, then refetch.
      scheduleRefetch(get().refetch);
      return;
    }

    const payload = isPlainObject(event)
      ? (event as SubscriptionEventEnvelope).payload
      : undefined;
    const fields = pickKnownFields(payload);

    if (typeof fields.id !== 'string') {
      // Cannot apply without an id: ignore safely, then refetch.
      scheduleRefetch(get().refetch);
      return;
    }

    const id = fields.id;

    if (type === 'record.deleted') {
      set((state) => ({
        records: state.records.filter((record) => record.id !== id),
      }));
      return;
    }

    set((state) => {
      const index = state.records.findIndex((record) => record.id === id);
      if (index === -1) {
        if (type === 'record.created') {
          const created: Record = {
            id,
            title: fields.title ?? '',
            status: fields.status ?? '',
            updatedAt: fields.updatedAt ?? '',
          };
          return { records: [...state.records, created] };
        }
        // Update for an unknown record: cannot apply, refetch instead.
        scheduleRefetch(get().refetch);
        return state;
      }
      const existing = state.records[index];
      const updated: Record = {
        ...existing,
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.status !== undefined ? { status: fields.status } : {}),
        ...(fields.updatedAt !== undefined ? { updatedAt: fields.updatedAt } : {}),
      };
      const records = state.records.slice();
      records[index] = updated;
      return { records };
    });
  },
}));
