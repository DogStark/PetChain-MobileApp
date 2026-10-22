/**
 * Waitlist model for vet appointment slots.
 *
 * Lifecycle:
 *   WAITING → NOTIFIED (slot opened, 15-min window starts)
 *   NOTIFIED → ACCEPTED (user claimed the slot within window)
 *   NOTIFIED → EXPIRED  (15-min window elapsed, next user notified)
 *   WAITING  → CANCELLED (user left the waitlist voluntarily)
 */

export enum WaitlistStatus {
  /** User is actively waiting for a slot */
  WAITING = 'WAITING',
  /** User has been notified of an available slot; 15-min acceptance window is open */
  NOTIFIED = 'NOTIFIED',
  /** User accepted the slot and an appointment was created */
  ACCEPTED = 'ACCEPTED',
  /** The 15-min acceptance window elapsed without a response */
  EXPIRED = 'EXPIRED',
  /** User voluntarily left the waitlist */
  CANCELLED = 'CANCELLED',
}

export interface WaitlistEntry {
  /** Unique identifier (UUID) */
  id: string;

  /** ID of the user who joined the waitlist */
  userId: string;

  /** ID of the vet the user wants to see */
  vetId: string;

  /** ID of the pet the appointment is for */
  petId: string;

  /**
   * Preferred date window start (inclusive).
   * ISO 8601 date string: "YYYY-MM-DD"
   */
  preferredDateStart: string;

  /**
   * Preferred date window end (inclusive).
   * ISO 8601 date string: "YYYY-MM-DD"
   */
  preferredDateEnd: string;

  /** Current status of this waitlist entry */
  status: WaitlistStatus;

  /**
   * 1-based position in the queue (among WAITING entries for the same vet).
   * Recalculated dynamically; stored for display purposes.
   */
  position: number;

  /**
   * Rough estimate of wait time in minutes.
   * Derived from position × average slot duration.
   */
  estimatedWaitMinutes: number;

  /**
   * ISO 8601 datetime when the user was notified of an available slot.
   * Null until status transitions to NOTIFIED.
   */
  notifiedAt: string | null;

  /**
   * ISO 8601 datetime when the 15-min acceptance window expires.
   * Set when status transitions to NOTIFIED.
   */
  acceptanceDeadline: string | null;

  /**
   * ID of the appointment created when the user accepted the slot.
   * Null until status is ACCEPTED.
   */
  appointmentId: string | null;

  /** ISO 8601 datetime when this entry was created */
  createdAt: string;

  /** ISO 8601 datetime when this entry was last updated */
  updatedAt: string;
}

// ─── Input / output types ─────────────────────────────────────────────────────

export interface JoinWaitlistInput {
  userId: string;
  vetId: string;
  petId: string;
  preferredDateStart: string;
  preferredDateEnd: string;
}

export interface WaitlistEntryResponse {
  success: boolean;
  data: WaitlistEntry;
  message?: string;
}

export interface WaitlistListResponse {
  success: boolean;
  data: WaitlistEntry[];
  total: number;
}

export interface WaitlistPositionInfo {
  entryId: string;
  position: number;
  estimatedWaitMinutes: number;
  status: WaitlistStatus;
}
