/**
 * Notification category actions for care reminders (Issue #1189).
 *
 * Exposes `COMPLETE` and `SNOOZE` notification category actions where supported
 * by the platform, confirms updates against server-confirmed permissions,
 * preserves offline queueing when connectivity is unavailable, keeps sensitive
 * pet data private by default on lock screens, and recovers cleanly from stale
 * notification payloads.
 */

export const CARE_REMINDER_CATEGORY_ID = 'care_reminder';
export const CARE_ACTION_COMPLETE = 'CARE_REMINDER_COMPLETE';
export const CARE_ACTION_SNOOZE = 'CARE_REMINDER_SNOOZE';

export const CARE_REMINDER_PAYLOAD_VERSION = 1;
export const DEFAULT_CARE_SNOOZE_MINUTES = 15;
export const MIN_CARE_SNOOZE_MINUTES = 5;
export const MAX_CARE_SNOOZE_MINUTES = 240;
export const DEFAULT_MAX_PAYLOAD_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const ACTION_IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export type CareReminderActionType =
  | typeof CARE_ACTION_COMPLETE
  | typeof CARE_ACTION_SNOOZE;

export type CareNotificationPrivacyMode = 'full' | 'minimal' | 'silent';

export const DEFAULT_CARE_PRIVACY_MODE: CareNotificationPrivacyMode = 'minimal';

const SENSITIVE_PAYLOAD_KEYS = new Set([
  'petid',
  'petname',
  'medication',
  'medicationname',
  'dosage',
  'diagnosis',
  'condition',
  'notes',
  'location',
  'address',
  'vetname',
]);

export interface CareReminderActionDescriptor {
  identifier: CareReminderActionType;
  buttonTitle: string;
  options: {
    opensAppToForeground: boolean;
    isDestructive?: boolean;
    isAuthenticationRequired?: boolean;
  };
  accessibilityLabel: string;
  accessibilityHint: string;
}

export interface CareReminderPayloadInput {
  reminderId: string;
  issuedAt: string;
  expiresAt?: string;
  version?: number;
  snoozeMinutes?: number;
  petId?: string;
  petName?: string;
  medicationName?: string;
  diagnosis?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CareReminderActionPayload {
  version: number;
  categoryId: typeof CARE_REMINDER_CATEGORY_ID;
  reminderId: string;
  issuedAt: string;
  expiresAt?: string;
  snoozeMinutes: number;
  privacyMode: CareNotificationPrivacyMode;
  petName?: string;
  medicationName?: string;
  metadata?: Record<string, unknown>;
}

export interface CareReminderRecoveryInstruction {
  action: 'refresh_reminders' | 'reauthenticate_or_sync' | 'open_care_schedule';
  announceMessage: string;
}

export type CarePayloadValidationResult =
  | {
      status: 'valid';
      payload: CareReminderActionPayload;
    }
  | {
      status: 'stale';
      reason: 'expired_timestamp' | 'exceeded_max_age';
      reminderId?: string;
      recovery: CareReminderRecoveryInstruction;
    }
  | {
      status: 'invalid';
      reason: 'malformed' | 'unknown_version' | 'unsupported_action';
      recovery: CareReminderRecoveryInstruction;
    };

export interface ServerCareActionResponse {
  ok: boolean;
  status: number;
  confirmed?: boolean;
  permissionDenied?: boolean;
  stale?: boolean;
  serverTimestamp?: string;
  snoozedUntil?: string;
  errorMessage?: string;
}

export interface OfflineQueuedCareAction {
  reminderId: string;
  action: CareReminderActionType;
  snoozeMinutes?: number;
  queuedAt: string;
}

export interface CareReminderCategoryRegistrar {
  setNotificationCategoryAsync: (
    identifier: string,
    actions: Array<{
      identifier: string;
      buttonTitle: string;
      options: { opensAppToForeground: boolean; isAuthenticationRequired?: boolean };
    }>,
  ) => Promise< unknown>;
}

export interface ExecuteCareReminderActionParams {
  actionIdentifier: string;
  rawPayload: unknown;
  nowMs?: number;
  maxAgeMs?: number;
  isOnline?: boolean;
  maxRetries?: number;
  confirmOnServer: (request: {
    reminderId: string;
    action: CareReminderActionType;
    snoozeMinutes: number;
  }) => Promise<ServerCareActionResponse>;
  enqueueOffline?: (item: OfflineQueuedCareAction) => Promise<void> | void;
  dismissNotification?: (reminderId: string) => Promise<void> | void;
  announceAccessibility?: (message: string) => Promise<void> | void;
}

export type CareReminderActionResult =
  | {
      status: 'confirmed';
      reminderId: string;
      action: CareReminderActionType;
      serverConfirmed: true;
      serverTimestamp: string;
      snoozedUntil?: string;
      announcement: string;
    }
  | {
      status: 'queued_offline';
      reminderId: string;
      action: CareReminderActionType;
      serverConfirmed: false;
      queuedAt: string;
      announcement: string;
    }
  | {
      status: 'denied';
      reminderId: string;
      action: CareReminderActionType;
      serverConfirmed: false;
      reason: 'permission_denied';
      recovery: CareReminderRecoveryInstruction;
      announcement: string;
    }
  | {
      status: 'stale';
      reminderId?: string;
      action?: CareReminderActionType;
      serverConfirmed: false;
      reason: 'expired_timestamp' | 'exceeded_max_age' | 'server_stale';
      recovery: CareReminderRecoveryInstruction;
      announcement: string;
    }
  | {
      status: 'duplicate';
      reminderId: string;
      action: CareReminderActionType;
      serverConfirmed: false;
      announcement: string;
    }
  | {
      status: 'ignored';
      reason: 'malformed' | 'unknown_version' | 'unsupported_action';
      serverConfirmed: false;
      recovery: CareReminderRecoveryInstruction;
    };

const processedActionTimestamps = new Map<string, number>();

export function clearProcessedCareActions(): void {
  processedActionTimestamps.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clampSnoozeMinutes(minutes?: number): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) {
    return DEFAULT_CARE_SNOOZE_MINUTES;
  }
  const rounded = Math.round(minutes);
  if (rounded < MIN_CARE_SNOOZE_MINUTES) return MIN_CARE_SNOOZE_MINUTES;
  if (rounded > MAX_CARE_SNOOZE_MINUTES) return MAX_CARE_SNOOZE_MINUTES;
  return rounded;
}

/**
 * Checks whether the current runtime platform supports interactive notification
 * category actions (`COMPLETE` and `SNOOZE`).
 */
export function isCareReminderActionsSupported(
  platformOs: string = 'ios',
  capabilities?: { supportsNotificationCategories?: boolean },
): boolean {
  if (capabilities?.supportsNotificationCategories === false) {
    return false;
  }
  const normalized = platformOs.toLowerCase();
  return normalized === 'ios' || normalized === 'android';
}

/**
 * Returns the interactive notification category actions with screen-reader
 * accessibility labels and hints.
 */
export function getCareReminderCategoryActions(options?: {
  snoozeMinutes?: number;
  requireAuthenticationOnComplete?: boolean;
}): CareReminderActionDescriptor[] {
  const snoozeMinutes = clampSnoozeMinutes(options?.snoozeMinutes);
  const requireAuth = options?.requireAuthenticationOnComplete ?? true;

  return [
    {
      identifier: CARE_ACTION_COMPLETE,
      buttonTitle: 'Complete',
      options: {
        opensAppToForeground: false,
        isAuthenticationRequired: requireAuth,
      },
      accessibilityLabel: 'Mark care reminder as complete',
      accessibilityHint:
        'Confirms completion with the server and dismisses this care reminder',
    },
    {
      identifier: CARE_ACTION_SNOOZE,
      buttonTitle: `Snooze ${snoozeMinutes} min`,
      options: {
        opensAppToForeground: false,
        isAuthenticationRequired: false,
      },
      accessibilityLabel: `Snooze care reminder for ${snoozeMinutes} minutes`,
      accessibilityHint: `Reschedules this reminder for ${snoozeMinutes} minutes from now`,
    },
  ];
}

/**
 * Registers the `care_reminder` category and its actions when supported by the
 * current platform. Gracefully no-ops on unsupported platforms.
 */
export async function registerCareReminderCategory(
  registrar: CareReminderCategoryRegistrar,
  options?: {
    platformOs?: string;
    supportsNotificationCategories?: boolean;
    snoozeMinutes?: number;
    requireAuthenticationOnComplete?: boolean;
  },
): Promise<{
  registered: boolean;
  categoryId: string;
  actions: CareReminderActionDescriptor[];
  reason?: 'unsupported_platform';
}> {
  const supported = isCareReminderActionsSupported(options?.platformOs, {
    supportsNotificationCategories: options?.supportsNotificationCategories,
  });

  if (!supported) {
    return {
      registered: false,
      categoryId: CARE_REMINDER_CATEGORY_ID,
      actions: [],
      reason: 'unsupported_platform',
    };
  }

  const actions = getCareReminderCategoryActions({
    snoozeMinutes: options?.snoozeMinutes,
    requireAuthenticationOnComplete: options?.requireAuthenticationOnComplete,
  });

  await registrar.setNotificationCategoryAsync(
    CARE_REMINDER_CATEGORY_ID,
    actions.map((item) => ({
      identifier: item.identifier,
      buttonTitle: item.buttonTitle,
      options: item.options,
    })),
  );

  return {
    registered: true,
    categoryId: CARE_REMINDER_CATEGORY_ID,
    actions,
  };
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  privacyMode: CareNotificationPrivacyMode,
): Record<string, unknown> | undefined {
  if (!metadata || privacyMode === 'silent') {
    return undefined;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (privacyMode !== 'full' && SENSITIVE_PAYLOAD_KEYS.has(key.toLowerCase())) {
      continue;
    }
    clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Builds a privacy-preserving payload for care reminder notification actions.
 * By default (`minimal`), sensitive pet and medical fields are stripped so
 * lock-screen payloads never leak private pet health information.
 */
export function buildCareReminderActionPayload(
  input: CareReminderPayloadInput,
  privacyMode: CareNotificationPrivacyMode = DEFAULT_CARE_PRIVACY_MODE,
): CareReminderActionPayload {
  const reminderId = typeof input.reminderId === 'string' ? input.reminderId.trim() : '';
  if (!reminderId) {
    throw new Error('reminderId is required to build a care reminder payload');
  }

  const issuedAtMs = Date.parse(input.issuedAt);
  if (Number.isNaN(issuedAtMs)) {
    throw new Error('issuedAt must be a valid ISO-8601 timestamp');
  }

  const basePayload: CareReminderActionPayload = {
    version: input.version ?? CARE_REMINDER_PAYLOAD_VERSION,
    categoryId: CARE_REMINDER_CATEGORY_ID,
    reminderId,
    issuedAt: new Date(issuedAtMs).toISOString(),
    snoozeMinutes: clampSnoozeMinutes(input.snoozeMinutes),
    privacyMode,
  };

  if (input.expiresAt) {
    const expiresAtMs = Date.parse(input.expiresAt);
    if (!Number.isNaN(expiresAtMs)) {
      basePayload.expiresAt = new Date(expiresAtMs).toISOString();
    }
  }

  const sanitizedMeta = sanitizeMetadata(input.metadata, privacyMode);
  if (sanitizedMeta) {
    basePayload.metadata = sanitizedMeta;
  }

  if (privacyMode === 'full') {
    if (input.petName) basePayload.petName = input.petName;
    if (input.medicationName) basePayload.medicationName = input.medicationName;
  }

  return basePayload;
}

/**
 * Validates a raw notification payload for care reminder actions and detects
 * stale or expired notifications so the app can recover cleanly.
 */
export function validateCareReminderActionPayload(
  raw: unknown,
  nowMs: number = Date.now(),
  maxAgeMs: number = DEFAULT_MAX_PAYLOAD_AGE_MS,
): CarePayloadValidationResult {
  if (!isRecord(raw)) {
    return {
      status: 'invalid',
      reason: 'malformed',
      recovery: {
        action: 'open_care_schedule',
        announceMessage:
          'Unable to process reminder notification. Opening care schedule.',
      },
    };
  }

  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return {
      status: 'invalid',
      reason: 'malformed',
      recovery: {
        action: 'open_care_schedule',
        announceMessage:
          'Unable to process reminder notification. Opening care schedule.',
      },
    };
  }

  if (version !== CARE_REMINDER_PAYLOAD_VERSION) {
    return {
      status: 'invalid',
      reason: 'unknown_version',
      recovery: {
        action: 'refresh_reminders',
        announceMessage:
          'This notification was created by a different app version. Refreshing reminders.',
      },
    };
  }

  const reminderId =
    typeof raw.reminderId === 'string' && raw.reminderId.trim().length > 0
      ? raw.reminderId.trim()
      : undefined;

  const issuedAtRaw = typeof raw.issuedAt === 'string' ? raw.issuedAt : undefined;
  const issuedAtMs = issuedAtRaw ? Date.parse(issuedAtRaw) : Number.NaN;

  if (!reminderId || Number.isNaN(issuedAtMs)) {
    return {
      status: 'invalid',
      reason: 'malformed',
      recovery: {
        action: 'open_care_schedule',
        announceMessage:
          'Reminder details are incomplete. Opening care schedule.',
      },
    };
  }

  if (typeof raw.expiresAt === 'string') {
    const expiresAtMs = Date.parse(raw.expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return {
        status: 'invalid',
        reason: 'malformed',
        recovery: {
          action: 'open_care_schedule',
          announceMessage:
            'Reminder expiration is invalid. Opening care schedule.',
        },
      };
    }
    if (nowMs > expiresAtMs) {
      return {
        status: 'stale',
        reason: 'expired_timestamp',
        reminderId,
        recovery: {
          action: 'refresh_reminders',
          announceMessage:
            'This care reminder has expired. Refreshing your care schedule.',
        },
      };
    }
  }

  if (nowMs - issuedAtMs > maxAgeMs) {
    return {
      status: 'stale',
      reason: 'exceeded_max_age',
      reminderId,
      recovery: {
        action: 'refresh_reminders',
        announceMessage:
          'This care reminder is out of date. Refreshing your care schedule.',
      },
    };
  }

  const privacyMode: CareNotificationPrivacyMode =
    raw.privacyMode === 'full' ||
    raw.privacyMode === 'minimal' ||
    raw.privacyMode === 'silent'
      ? raw.privacyMode
      : DEFAULT_CARE_PRIVACY_MODE;

  const snoozeMinutes = clampSnoozeMinutes(
    typeof raw.snoozeMinutes === 'number' ? raw.snoozeMinutes : undefined,
  );

  return {
    status: 'valid',
    payload: {
      version: CARE_REMINDER_PAYLOAD_VERSION,
      categoryId: CARE_REMINDER_CATEGORY_ID,
      reminderId,
      issuedAt: new Date(issuedAtMs).toISOString(),
      ...(typeof raw.expiresAt === 'string'
        ? { expiresAt: new Date(Date.parse(raw.expiresAt)).toISOString() }
        : {}),
      snoozeMinutes,
      privacyMode,
    },
  };
}

function isSupportedCareAction(value: string): value is CareReminderActionType {
  return value === CARE_ACTION_COMPLETE || value === CARE_ACTION_SNOOZE;
}

/**
 * Executes a `COMPLETE` or `SNOOZE` care reminder category action:
 * - Validates and recovers cleanly from stale or malformed payloads.
 * - Deduplicates repeated taps within the idempotency window.
 * - Preserves offline behavior by queueing actions when offline or when
 *   transient network errors occur.
 * - Confirms updates and permissions with the server before reporting
 *   completion.
 */
export async function executeCareReminderAction(
  params: ExecuteCareReminderActionParams,
): Promise<CareReminderActionResult> {
  const nowMs = params.nowMs ?? Date.now();

  if (!isSupportedCareAction(params.actionIdentifier)) {
    return {
      status: 'ignored',
      reason: 'unsupported_action',
      serverConfirmed: false,
      recovery: {
        action: 'open_care_schedule',
        announceMessage: 'Unsupported reminder action.',
      },
    };
  }

  const validation = validateCareReminderActionPayload(
    params.rawPayload,
    nowMs,
    params.maxAgeMs,
  );

  if (validation.status === 'invalid') {
    await params.announceAccessibility?.(validation.recovery.announceMessage);
    return {
      status: 'ignored',
      reason: validation.reason,
      serverConfirmed: false,
      recovery: validation.recovery,
    };
  }

  if (validation.status === 'stale') {
    await params.announceAccessibility?.(validation.recovery.announceMessage);
    return {
      status: 'stale',
      reminderId: validation.reminderId,
      action: params.actionIdentifier,
      serverConfirmed: false,
      reason: validation.reason,
      recovery: validation.recovery,
      announcement: validation.recovery.announceMessage,
    };
  }

  const { payload } = validation;
  const action = params.actionIdentifier;
  const dedupKey = `${payload.reminderId}::${action}`;
  const previousTimestamp = processedActionTimestamps.get(dedupKey);

  if (
    previousTimestamp !== undefined &&
    nowMs - previousTimestamp < ACTION_IDEMPOTENCY_WINDOW_MS
  ) {
    const announcement = 'Care reminder action is already processed.';
    await params.announceAccessibility?.(announcement);
    return {
      status: 'duplicate',
      reminderId: payload.reminderId,
      action,
      serverConfirmed: false,
      announcement,
    };
  }

  const queueOfflineFallback = async (): Promise<CareReminderActionResult> => {
    const queuedAt = new Date(nowMs).toISOString();
    await params.enqueueOffline?.({
      reminderId: payload.reminderId,
      action,
      snoozeMinutes:
        action === CARE_ACTION_SNOOZE ? payload.snoozeMinutes : undefined,
      queuedAt,
    });
    processedActionTimestamps.set(dedupKey, nowMs);
    const announcement =
      action === CARE_ACTION_COMPLETE
        ? 'Offline: care reminder completion queued and will sync when connected.'
        : `Offline: care reminder snoozed for ${payload.snoozeMinutes} minutes locally.`;
    await params.announceAccessibility?.(announcement);
    return {
      status: 'queued_offline',
      reminderId: payload.reminderId,
      action,
      serverConfirmed: false,
      queuedAt,
      announcement,
    };
  };

  if (params.isOnline === false) {
    return queueOfflineFallback();
  }

  const maxRetries = Math.max(0, params.maxRetries ?? 2);
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await params.confirmOnServer({
        reminderId: payload.reminderId,
        action,
        snoozeMinutes: payload.snoozeMinutes,
      });

      if (response.permissionDenied || response.status === 403 || response.status === 401) {
        const recovery: CareReminderRecoveryInstruction = {
          action: 'reauthenticate_or_sync',
          announceMessage:
            'Permission denied to update this care reminder. Open the app to verify account access.',
        };
        await params.announceAccessibility?.(recovery.announceMessage);
        return {
          status: 'denied',
          reminderId: payload.reminderId,
          action,
          serverConfirmed: false,
          reason: 'permission_denied',
          recovery,
          announcement: recovery.announceMessage,
        };
      }

      if (response.stale || response.status === 404 || response.status === 409 || response.status === 410) {
        const recovery: CareReminderRecoveryInstruction = {
          action: 'refresh_reminders',
          announceMessage:
            'This care reminder was already updated or removed. Refreshing your care schedule.',
        };
        await params.announceAccessibility?.(recovery.announceMessage);
        return {
          status: 'stale',
          reminderId: payload.reminderId,
          action,
          serverConfirmed: false,
          reason: 'server_stale',
          recovery,
          announcement: recovery.announceMessage,
        };
      }

      if (response.ok && response.confirmed !== false) {
        processedActionTimestamps.set(dedupKey, nowMs);
        await params.dismissNotification?.(payload.reminderId);

        const serverTimestamp =
          response.serverTimestamp ?? new Date(nowMs).toISOString();
        const snoozedUntil =
          action === CARE_ACTION_SNOOZE
            ? response.snoozedUntil ??
              new Date(nowMs + payload.snoozeMinutes * 60 * 1000).toISOString()
            : undefined;

        const announcement =
          action === CARE_ACTION_COMPLETE
            ? 'Care reminder marked as complete.'
            : `Care reminder snoozed for ${payload.snoozeMinutes} minutes.`;
        await params.announceAccessibility?.(announcement);

        return {
          status: 'confirmed',
          reminderId: payload.reminderId,
          action,
          serverConfirmed: true,
          serverTimestamp,
          ...(snoozedUntil ? { snoozedUntil } : {}),
          announcement,
        };
      }

      // Retryable server error (e.g. 500/502/503)
      if (attempt < maxRetries) {
        attempt += 1;
        continue;
      }

      if (params.enqueueOffline) {
        return queueOfflineFallback();
      }
      throw new Error(response.errorMessage ?? `Server returned status ${response.status}`);
    } catch (error) {
      if (attempt < maxRetries) {
        attempt += 1;
        continue;
      }
      if (params.enqueueOffline) {
        return queueOfflineFallback();
      }
      throw error;
    }
  }

  return queueOfflineFallback();
}
