import { gql } from '@apollo/client';

export type SubscriptionEvent = {
  __typename?: string;
  id?: string;
  [key: string]: unknown;
};

export type SubscriptionStore = {
  applyEvent: (event: SubscriptionEvent) => void;
  refetch: () => Promise<void>;
};

const SUPPORTED_TYPENAMES = new Set([
  'Credential',
  'CredentialUpdated',
  'CredentialExpired',
]);

const KNOWN_FIELDS = new Set([
  'id',
  '__typename',
  'status',
  'expiresAt',
  'updatedAt',
  'credentialId',
]);

const REFETCH_MIN_INTERVAL_MS = 5000;
const REFETCH_MAX_PER_WINDOW = 3;
const REFETCH_WINDOW_MS = 60000;

let lastRefetchAt = 0;
let refetchTimestamps: number[] = [];
let refetchInFlight: Promise<void> | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an incoming subscription event envelope.
 * Returns null when the record is unsupported or malformed so callers can
 * safely ignore it without throwing.
 */
export function validateEventEnvelope(
  event: unknown,
): SubscriptionEvent | null {
  if (!isPlainObject(event)) {
    return null;
  }

  const typename = event.__typename;
  if (typeof typename !== 'string' || !SUPPORTED_TYPENAMES.has(typename)) {
    return null;
  }

  if (event.id !== undefined && typeof event.id !== 'string') {
    return null;
  }

  return event as SubscriptionEvent;
}

/**
 * Pick only the known fields present in a supported partial event.
 * Unknown/extra fields are dropped so newer schemas cannot corrupt the store.
 */
export function pickKnownFields(
  event: SubscriptionEvent,
): SubscriptionEvent {
  const result: SubscriptionEvent = {};
  for (const key of Object.keys(event)) {
    if (KNOWN_FIELDS.has(key)) {
      result[key] = event[key];
    }
  }
  return result;
}

/**
 * Bounded, deduplicated refetch. Concurrent calls share a single in-flight
 * request and repeated triggers are rate-limited within a rolling window.
 */
export function requestBoundedRefetch(
  store: Pick<SubscriptionStore, 'refetch'>,
): Promise<void> {
  if (refetchInFlight) {
    return refetchInFlight;
  }

  const now = Date.now();
  refetchTimestamps = refetchTimestamps.filter(
    (ts) => now - ts < REFETCH_WINDOW_MS,
  );

  if (
    now - lastRefetchAt < REFETCH_MIN_INTERVAL_MS ||
    refetchTimestamps.length >= REFETCH_MAX_PER_WINDOW
  ) {
    return Promise.resolve();
  }

  lastRefetchAt = now;
  refetchTimestamps.push(now);

  refetchInFlight = Promise.resolve()
    .then(() => store.refetch())
    .catch(() => undefined)
    .finally(() => {
      refetchInFlight = null;
    });

  return refetchInFlight;
}

/**
 * Safely apply a subscription event to the store.
 * Invalid events are ignored; supported partial events update only known
 * fields; unappliable events trigger a bounded refetch.
 */
export function handleSubscriptionEvent(
  store: SubscriptionStore,
  event: unknown,
): void {
  const validated = validateEventEnvelope(event);

  if (!validated) {
    void requestBoundedRefetch(store);
    return;
  }

  try {
    const partial = pickKnownFields(validated);
    store.applyEvent(partial);
  } catch {
    void requestBoundedRefetch(store);
  }
}

export const CREDENTIAL_SUBSCRIPTION = gql`
  subscription OnCredentialEvent {
    credentialEvent {
      __typename
      id
      status
      expiresAt
      updatedAt
      credentialId
    }
  }
`;
