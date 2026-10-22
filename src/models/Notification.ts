/**
 * Notification model for in-app and push notifications.
 *
 * Timestamps are ISO 8601 strings, consistent with the other models in this
 * directory (see `Pet.ts`, `Appointment.ts`).
 */

/** The kind of event a notification represents. */
export enum NotificationType {
  MEDICATION = 'MEDICATION',
  APPOINTMENT = 'APPOINTMENT',
  VACCINATION = 'VACCINATION',
  EMERGENCY = 'EMERGENCY',
  SYSTEM = 'SYSTEM',
}

/** How urgently a notification should be surfaced to the user. */
export enum NotificationPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** Where a notification was delivered from. */
export type NotificationChannel = 'push' | 'in_app';

// ---------------------------------------------------------------------------
// Per-type data shapes
// ---------------------------------------------------------------------------

export interface MedicationNotificationData {
  petId: string;
  medicationId: string;
  /** ISO timestamp the dose is due. */
  scheduledFor: string;
  dosage?: string;
  /** Set when this is a follow-up for a dose the user has not acknowledged. */
  isOverdue?: boolean;
}

export interface AppointmentNotificationData {
  petId: string;
  appointmentId: string;
  /** ISO timestamp the appointment starts. */
  scheduledFor: string;
  vetId?: string;
  clinicName?: string;
  /** Minutes before the appointment that this reminder fired. */
  remindsInMinutes?: number;
}

export interface VaccinationNotificationData {
  petId: string;
  vaccinationId: string;
  vaccineName: string;
  /** ISO date the vaccination is due. */
  dueDate: string;
  isOverdue?: boolean;
}

export interface EmergencyNotificationData {
  petId?: string;
  /** Emergency session share token, used to open the live session. */
  shareToken: string;
  /** Free-text description of the emergency. */
  reason?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface SystemNotificationData {
  /** Optional deep link or external URL to open when tapped. */
  url?: string;
  /** Set for release/update announcements. */
  version?: string;
  category?: 'announcement' | 'security' | 'account' | 'update';
}

/**
 * Discriminated union of every notification shape, keyed on `type`.
 *
 * Narrowing on `type` gives a correctly typed `data` field:
 *
 * ```ts
 * if (payload.type === NotificationType.MEDICATION) {
 *   payload.data.medicationId; // MedicationNotificationData
 * }
 * ```
 */
export type NotificationPayload =
  | { type: NotificationType.MEDICATION; data: MedicationNotificationData }
  | { type: NotificationType.APPOINTMENT; data: AppointmentNotificationData }
  | { type: NotificationType.VACCINATION; data: VaccinationNotificationData }
  | { type: NotificationType.EMERGENCY; data: EmergencyNotificationData }
  | { type: NotificationType.SYSTEM; data: SystemNotificationData };

/** The `data` field of any notification, regardless of type. */
export type NotificationData = NotificationPayload['data'];

/** Resolves the data shape for a single notification type. */
export type NotificationDataFor<T extends NotificationType> = Extract<
  NotificationPayload,
  { type: T }
>['data'];

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

/** An in-app or push notification as stored and rendered by the app. */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Type-specific payload — narrow with `isNotificationOfType` before use. */
  data?: NotificationData;
  isRead: boolean;
  /** ISO timestamp the notification was created. */
  createdAt: string;
  /** ISO timestamp the user read it, when `isRead` is true. */
  readAt?: string;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  /** In-app route to open when tapped. */
  deepLink?: string;
}

/**
 * A notification narrowed to one type, with `data` required and correctly
 * typed. Use as the return type of type-specific handlers.
 */
export type TypedNotification<T extends NotificationType> = Omit<Notification, 'type' | 'data'> & {
  type: T;
  data: NotificationDataFor<T>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard narrowing a notification to a specific type. */
export const isNotificationOfType = <T extends NotificationType>(
  notification: Notification,
  type: T,
): notification is TypedNotification<T> => notification.type === type;

/** Notification types that should bypass do-not-disturb. */
export const CRITICAL_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NotificationType.EMERGENCY,
] as const;

/**
 * Factory that builds a Notification from partial data, applying sensible
 * defaults — mirrors the `createPet` pattern in `Pet.ts`.
 */
export const createNotification = (data: Partial<Notification>): Notification => ({
  id: data.id || '',
  type: data.type || NotificationType.SYSTEM,
  title: data.title || '',
  body: data.body || '',
  data: data.data,
  isRead: data.isRead ?? false,
  createdAt: data.createdAt || new Date().toISOString(),
  readAt: data.readAt,
  priority: data.priority ?? NotificationPriority.NORMAL,
  channel: data.channel,
  deepLink: data.deepLink,
});
