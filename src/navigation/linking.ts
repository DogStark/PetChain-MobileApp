import { Linking, Platform } from 'react-native';
import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Notification deep-link handling.
 *
 * Notification taps can arrive while the app is cold, foregrounded, or already
 * handling another navigation action. To keep routing idempotent we:
 *  - consume each notification response id at most once,
 *  - replay cold-start responses only once navigation is ready,
 *  - validate the target resource before navigating and fall back to the
 *    notification center for invalid, revoked, or unauthorized targets,
 *  - queue exactly one pending intent until the navigator is ready.
 */

const RESPONSE_TTL_MS = 5 * 60 * 1000;

const consumedResponseIds = new Map<string, number>();

let navigationReady = false;
let pendingIntent: NotificationIntent | null = null;
let listenerRegistered = false;
let unsubscribe: (() => void) | null = null;

export type NotificationIntent =
  | { type: 'pet'; petId: string }
  | { type: 'appointment'; appointmentId: string }
  | { type: 'notificationCenter' };

export interface NotificationResponse {
  id: string;
  target?: {
    type: 'pet' | 'appointment';
    id: string;
  };
  receivedAt?: number;
}

/**
 * A resolver is supplied by the app so the linking layer can validate that a
 * target still exists and is accessible to the current (possibly signed-out)
 * user before navigating.
 */
export type TargetResolver = (
  target: NonNullable<NotificationResponse['target']>,
) => Promise<boolean> | boolean;

let targetResolver: TargetResolver | null = null;

export function setTargetResolver(resolver: TargetResolver | null): void {
  targetResolver = resolver;
}

function pruneConsumed(now: number): void {
  for (const [id, timestamp] of consumedResponseIds) {
    if (now - timestamp > RESPONSE_TTL_MS) {
      consumedResponseIds.delete(id);
    }
  }
}

/**
 * Returns true when the response id has not been seen before. Marks it as
 * consumed so the same response is never routed twice.
 */
export function consumeResponseId(id: string, now: number = Date.now()): boolean {
  pruneConsumed(now);
  if (consumedResponseIds.has(id)) {
    return false;
  }
  consumedResponseIds.set(id, now);
  return true;
}

/** Test helper: clears single-consumption state. */
export function resetNotificationState(): void {
  consumedResponseIds.clear();
  pendingIntent = null;
  navigationReady = false;
}

async function resolveIntent(
  response: NotificationResponse,
): Promise<NotificationIntent> {
  const target = response.target;
  if (!target || !target.id) {
    return { type: 'notificationCenter' };
  }

  if (!targetResolver) {
    return { type: 'notificationCenter' };
  }

  let valid = false;
  try {
    valid = await targetResolver(target);
  } catch {
    valid = false;
  }

  if (!valid) {
    return { type: 'notificationCenter' };
  }

  return target.type === 'pet'
    ? { type: 'pet', petId: target.id }
    : { type: 'appointment', appointmentId: target.id };
}

function navigateToIntent(
  navigate: (intent: NotificationIntent) => void,
  intent: NotificationIntent,
): void {
  navigate(intent);
}

/**
 * Handles a notification response. Safe to call from cold start, warm start,
 * or duplicate events: the response id is consumed at most once and, when the
 * navigator is not ready yet, exactly one intent is queued for replay.
 */
export async function handleNotificationResponse(
  response: NotificationResponse,
  navigate: (intent: NotificationIntent) => void,
): Promise<void> {
  if (!response || !response.id) {
    return;
  }

  if (!consumeResponseId(response.id)) {
    return;
  }

  const intent = await resolveIntent(response);

  if (!navigationReady) {
    pendingIntent = intent;
    return;
  }

  navigateToIntent(navigate, intent);
}

/**
 * Marks navigation as ready and replays a single queued cold-start intent.
 */
export function setNavigationReady(
  ready: boolean,
  navigate?: (intent: NotificationIntent) => void,
): void {
  navigationReady = ready;

  if (ready && pendingIntent && navigate) {
    const intent = pendingIntent;
    pendingIntent = null;
    navigateToIntent(navigate, intent);
  }
}

/**
 * Registers the notification response listener exactly once. Repeated calls
 * (hot reload, account changes) are no-ops so duplicate listeners are never
 * registered.
 */
export function registerNotificationListener(
  subscribe: (handler: (response: NotificationResponse) => void) => () => void,
  navigate: (intent: NotificationIntent) => void,
): void {
  if (listenerRegistered) {
    return;
  }
  listenerRegistered = true;
  unsubscribe = subscribe((response) => {
    void handleNotificationResponse(response, navigate);
  });
}

/** Test helper: tears down the registered listener. */
export function unregisterNotificationListener(): void {
  if (unsubscribe) {
    unsubscribe();
  }
  unsubscribe = null;
  listenerRegistered = false;
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['myapp://', 'https://app.example.com'],
  config: {
    screens: {
      NotificationCenter: 'notifications',
      PetDetails: 'pets/:petId',
      AppointmentDetails: 'appointments/:appointmentId',
    },
  },
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    if (url != null) {
      return url;
    }
    return null;
  },
  subscribe(listener) {
    const onReceiveURL = ({ url }: { url: string }) => listener(url);
    const subscription = Linking.addEventListener('url', onReceiveURL);
    return () => subscription.remove();
  },
};

export const isIOS = Platform.OS === 'ios';
