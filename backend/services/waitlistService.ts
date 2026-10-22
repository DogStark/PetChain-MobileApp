/**
 * Waitlist service — backend client module.
 *
 * Manages the full lifecycle of waitlist entries:
 *   - Joining / leaving the waitlist
 *   - Slot-opened notifications (triggered when an appointment is cancelled)
 *   - 15-minute acceptance window with automatic fallthrough to the next user
 *   - Fair FIFO slot assignment
 *   - Position and estimated-wait-time tracking
 *
 * Storage: AsyncStorage (same pattern as the rest of the app).
 * Notifications: expo-notifications via notificationService helpers.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { sendAlertNotification } from '../../src/services/notificationService';
import {
  WaitlistStatus,
  type WaitlistEntry,
  type JoinWaitlistInput,
  type WaitlistListResponse,
  type WaitlistEntryResponse,
  type WaitlistPositionInfo,
} from '../models/WaitlistEntry';

// ─── Constants ────────────────────────────────────────────────────────────────

const WAITLIST_KEY = '@waitlist_entries';

/** Duration of the acceptance window in milliseconds (15 minutes) */
export const ACCEPTANCE_WINDOW_MS = 15 * 60 * 1000;

/** Assumed average appointment slot duration in minutes (used for ETA estimates) */
const AVG_SLOT_DURATION_MINUTES = 30;

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function readAll(): Promise<WaitlistEntry[]> {
  const raw = await AsyncStorage.getItem(WAITLIST_KEY);
  return raw ? (JSON.parse(raw) as WaitlistEntry[]) : [];
}

async function writeAll(entries: WaitlistEntry[]): Promise<void> {
  await AsyncStorage.setItem(WAITLIST_KEY, JSON.stringify(entries));
}

// ─── Position helpers ─────────────────────────────────────────────────────────

/**
 * Returns all WAITING entries for a given vet, sorted by createdAt (FIFO).
 */
function getQueue(entries: WaitlistEntry[], vetId: string): WaitlistEntry[] {
  return entries
    .filter((e) => e.vetId === vetId && e.status === WaitlistStatus.WAITING)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * Recalculates and mutates the `position` and `estimatedWaitMinutes` fields
 * for all WAITING entries of a vet in-place.
 */
function recalculatePositions(entries: WaitlistEntry[], vetId: string): void {
  const queue = getQueue(entries, vetId);
  queue.forEach((entry, idx) => {
    entry.position = idx + 1;
    entry.estimatedWaitMinutes = (idx + 1) * AVG_SLOT_DURATION_MINUTES;
    entry.updatedAt = new Date().toISOString();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a user to the waitlist for a specific vet and time window.
 * Prevents duplicate active entries for the same user+vet combination.
 */
export async function joinWaitlist(input: JoinWaitlistInput): Promise<WaitlistEntryResponse> {
  const { userId, vetId, petId, preferredDateStart, preferredDateEnd } = input;

  if (!userId || !vetId || !petId || !preferredDateStart || !preferredDateEnd) {
    return {
      success: false,
      data: null as unknown as WaitlistEntry,
      message: 'userId, vetId, petId, preferredDateStart, and preferredDateEnd are all required.',
    };
  }

  const start = new Date(preferredDateStart);
  const end = new Date(preferredDateEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {
      success: false,
      data: null as unknown as WaitlistEntry,
      message: 'preferredDateStart and preferredDateEnd must be valid ISO date strings.',
    };
  }
  if (end < start) {
    return {
      success: false,
      data: null as unknown as WaitlistEntry,
      message: 'preferredDateEnd must be on or after preferredDateStart.',
    };
  }

  const entries = await readAll();

  // Prevent duplicate active entries for the same user + vet
  const existing = entries.find(
    (e) =>
      e.userId === userId &&
      e.vetId === vetId &&
      (e.status === WaitlistStatus.WAITING || e.status === WaitlistStatus.NOTIFIED),
  );
  if (existing) {
    return {
      success: false,
      data: existing,
      message: 'You are already on the waitlist for this vet.',
    };
  }

  const now = new Date().toISOString();
  const newEntry: WaitlistEntry = {
    id: `wl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    userId,
    vetId,
    petId,
    preferredDateStart,
    preferredDateEnd,
    status: WaitlistStatus.WAITING,
    position: 0, // recalculated below
    estimatedWaitMinutes: 0,
    notifiedAt: null,
    acceptanceDeadline: null,
    appointmentId: null,
    createdAt: now,
    updatedAt: now,
  };

  entries.push(newEntry);
  recalculatePositions(entries, vetId);
  await writeAll(entries);

  // Return the entry with its freshly calculated position
  const saved = entries.find((e) => e.id === newEntry.id)!;
  return { success: true, data: saved };
}

/**
 * Remove a user from the waitlist voluntarily.
 * Sets status to CANCELLED and recalculates positions for remaining users.
 */
export async function leaveWaitlist(entryId: string): Promise<WaitlistEntryResponse> {
  if (!entryId?.trim()) {
    return {
      success: false,
      data: null as unknown as WaitlistEntry,
      message: 'entryId is required.',
    };
  }

  const entries = await readAll();
  const idx = entries.findIndex((e) => e.id === entryId);

  if (idx === -1) {
    return {
      success: false,
      data: null as unknown as WaitlistEntry,
      message: 'Waitlist entry not found.',
    };
  }

  const entry = entries[idx];

  if (entry.status === WaitlistStatus.ACCEPTED || entry.status === WaitlistStatus.CANCELLED) {
    return {
      success: false,
      data: entry,
      message: `Cannot cancel an entry with status "${entry.status}".`,
    };
  }

  const vetId = entry.vetId;
  entry.status = WaitlistStatus.CANCELLED;
  entry.updatedAt = new Date().toISOString();

  recalculatePositions(entries, vetId);
  await writeAll(entries);

  return { success: true, data: entry };
}

/**
 * Called when an appointment slot opens (e.g., a cancellation).
 *
 * Finds the first WAITING user for the given vet whose preferred date window
 * overlaps with the freed slot date, notifies them, and starts the 15-minute
 * acceptance window.
 *
 * Returns the notified entry, or null if the queue is empty.
 */
export async function notifyNextInQueue(
  vetId: string,
  slotDate: string,
): Promise<WaitlistEntry | null> {
  if (!vetId?.trim() || !slotDate?.trim()) return null;

  const entries = await readAll();

  // Expire any stale NOTIFIED entries first (safety net for missed timers)
  await expireStaleNotifications(entries);

  const queue = getQueue(entries, vetId);

  // Find the first user whose preferred window covers the freed slot date
  const slotDateObj = new Date(slotDate);
  const candidate = queue.find((e) => {
    const start = new Date(e.preferredDateStart);
    const end = new Date(e.preferredDateEnd);
    return slotDateObj >= start && slotDateObj <= end;
  });

  if (!candidate) return null;

  const now = new Date();
  candidate.status = WaitlistStatus.NOTIFIED;
  candidate.notifiedAt = now.toISOString();
  candidate.acceptanceDeadline = new Date(now.getTime() + ACCEPTANCE_WINDOW_MS).toISOString();
  candidate.updatedAt = now.toISOString();

  await writeAll(entries);

  // Fire a push notification to the user
  await sendAlertNotification(
    '📅 Appointment Slot Available',
    `A slot opened with your vet on ${slotDate}. You have 15 minutes to accept.`,
    {
      type: 'waitlist',
      waitlistEntryId: candidate.id,
      vetId,
      slotDate,
    },
  );

  return candidate;
}

/**
 * Accept the offered slot.
 *
 * Validates that the acceptance window has not expired, marks the entry as
 * ACCEPTED, records the resulting appointmentId, and recalculates positions.
 *
 * Returns the updated entry, or an error response if the window has closed.
 */
export async function acceptSlot(
  entryId: string,
  appointmentId: string,
): Promise<WaitlistEntryResponse> {
  if (!entryId?.trim() || !appointmentId?.trim()) {
    return {
      success: false,
      data: null as unknown as WaitlistEntry,
      message: 'entryId and appointmentId are required.',
    };
  }

  const entries = await readAll();
  const entry = entries.find((e) => e.id === entryId);

  if (!entry) {
    return {
      success: false,
      data: null as unknown as WaitlistEntry,
      message: 'Waitlist entry not found.',
    };
  }

  if (entry.status !== WaitlistStatus.NOTIFIED) {
    return {
      success: false,
      data: entry,
      message: `Cannot accept a slot for an entry with status "${entry.status}".`,
    };
  }

  // Check acceptance window
  if (entry.acceptanceDeadline && new Date() > new Date(entry.acceptanceDeadline)) {
    // Window has expired — expire this entry and offer to the next user
    entry.status = WaitlistStatus.EXPIRED;
    entry.updatedAt = new Date().toISOString();
    recalculatePositions(entries, entry.vetId);
    await writeAll(entries);

    return {
      success: false,
      data: entry,
      message:
        'The 15-minute acceptance window has expired. The slot has been offered to the next user.',
    };
  }

  entry.status = WaitlistStatus.ACCEPTED;
  entry.appointmentId = appointmentId;
  entry.updatedAt = new Date().toISOString();

  recalculatePositions(entries, entry.vetId);
  await writeAll(entries);

  return { success: true, data: entry };
}

/**
 * Expire any NOTIFIED entries whose acceptance deadline has passed,
 * then cascade-notify the next eligible user in each affected vet queue.
 *
 * Call this on app resume or periodically to handle missed timers.
 */
export async function processExpiredNotifications(): Promise<WaitlistEntry[]> {
  const entries = await readAll();
  const expired = await expireStaleNotifications(entries);

  // For each unique vet that had an expiry, try to notify the next user.
  // We pass the original slot date from the expired entry's preferred window start
  // as a best-effort approximation (the real slot date is not stored on the entry).
  const affectedVets = [...new Set(expired.map((e) => e.vetId))];
  for (const vetId of affectedVets) {
    const expiredEntry = expired.find((e) => e.vetId === vetId);
    if (expiredEntry) {
      await notifyNextInQueue(vetId, expiredEntry.preferredDateStart);
    }
  }

  return expired;
}

/**
 * Get all waitlist entries for a specific user.
 */
export async function getUserWaitlistEntries(userId: string): Promise<WaitlistListResponse> {
  if (!userId?.trim()) {
    return { success: false, data: [], total: 0 };
  }

  const entries = await readAll();
  const userEntries = entries
    .filter((e) => e.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { success: true, data: userEntries, total: userEntries.length };
}

/**
 * Get the current position and estimated wait time for a specific entry.
 */
export async function getWaitlistPosition(entryId: string): Promise<WaitlistPositionInfo | null> {
  if (!entryId?.trim()) return null;

  const entries = await readAll();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return null;

  return {
    entryId: entry.id,
    position: entry.position,
    estimatedWaitMinutes: entry.estimatedWaitMinutes,
    status: entry.status,
  };
}

/**
 * Get all active (WAITING or NOTIFIED) waitlist entries for a vet, in queue order.
 */
export async function getVetWaitlist(vetId: string): Promise<WaitlistListResponse> {
  if (!vetId?.trim()) {
    return { success: false, data: [], total: 0 };
  }

  const entries = await readAll();
  const active = entries
    .filter(
      (e) =>
        e.vetId === vetId &&
        (e.status === WaitlistStatus.WAITING || e.status === WaitlistStatus.NOTIFIED),
    )
    .sort((a, b) => a.position - b.position);

  return { success: true, data: active, total: active.length };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Mutates `entries` in-place: transitions any NOTIFIED entry whose
 * acceptanceDeadline has passed to EXPIRED, persists, and returns the expired ones.
 */
async function expireStaleNotifications(entries: WaitlistEntry[]): Promise<WaitlistEntry[]> {
  const now = new Date();
  const expired: WaitlistEntry[] = [];

  for (const entry of entries) {
    if (
      entry.status === WaitlistStatus.NOTIFIED &&
      entry.acceptanceDeadline &&
      now > new Date(entry.acceptanceDeadline)
    ) {
      entry.status = WaitlistStatus.EXPIRED;
      entry.updatedAt = now.toISOString();
      expired.push(entry);
    }
  }

  if (expired.length > 0) {
    const affectedVets = [...new Set(expired.map((e) => e.vetId))];
    affectedVets.forEach((vetId) => recalculatePositions(entries, vetId));
    await writeAll(entries);
  }

  return expired;
}
