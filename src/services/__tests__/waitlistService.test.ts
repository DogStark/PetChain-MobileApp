/**
 * Unit tests for backend/services/waitlistService.ts
 *
 * Covers:
 *   - joinWaitlist: validation, duplicate prevention, position assignment
 *   - leaveWaitlist: cancellation, guard against double-cancel
 *   - notifyNextInQueue: FIFO ordering, date-window filtering, notification dispatch
 *   - acceptSlot: happy path, expired window, wrong status
 *   - processExpiredNotifications: cascade to next user
 *   - getUserWaitlistEntries / getWaitlistPosition / getVetWaitlist
 *   - Slot assignment fairness (FIFO ordering across multiple users)
 *   - Timeout handling (15-minute acceptance window)
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// In-memory AsyncStorage — shared between the mock factory and test helpers.
// Declared before jest.mock() so the factory closure can reference it.
const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    delete store[key];
    return Promise.resolve();
  }),
}));

// Notification service — capture calls without side effects
const mockSendAlert = jest.fn().mockResolvedValue('notif-id-1');
jest.mock('../../services/notificationService', () => ({
  sendAlertNotification: (...args: unknown[]) => mockSendAlert(...args),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { WaitlistStatus } from '../../../../backend/models/WaitlistEntry';
import {
  joinWaitlist,
  leaveWaitlist,
  notifyNextInQueue,
  acceptSlot,
  processExpiredNotifications,
  getUserWaitlistEntries,
  getWaitlistPosition,
  getVetWaitlist,
  ACCEPTANCE_WINDOW_MS,
} from '../../../../backend/services/waitlistService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearStore() {
  Object.keys(store).forEach((k) => delete store[k]);
}

const BASE_INPUT = {
  userId: 'user-1',
  vetId: 'vet-1',
  petId: 'pet-1',
  preferredDateStart: '2026-07-01',
  preferredDateEnd: '2026-07-31',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ─── joinWaitlist ─────────────────────────────────────────────────────────────

describe('joinWaitlist()', () => {
  it('creates a new entry with WAITING status and position 1', async () => {
    const result = await joinWaitlist(BASE_INPUT);

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(WaitlistStatus.WAITING);
    expect(result.data.position).toBe(1);
    expect(result.data.userId).toBe('user-1');
    expect(result.data.vetId).toBe('vet-1');
    expect(result.data.petId).toBe('pet-1');
    expect(result.data.id).toMatch(/^wl_/);
    expect(result.data.notifiedAt).toBeNull();
    expect(result.data.acceptanceDeadline).toBeNull();
    expect(result.data.appointmentId).toBeNull();
  });

  it('assigns sequential positions to multiple users for the same vet', async () => {
    const r1 = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });
    const r2 = await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });
    const r3 = await joinWaitlist({ ...BASE_INPUT, userId: 'user-3' });

    expect(r1.data.position).toBe(1);
    expect(r2.data.position).toBe(2);
    expect(r3.data.position).toBe(3);
  });

  it('prevents duplicate active entries for the same user + vet', async () => {
    await joinWaitlist(BASE_INPUT);
    const duplicate = await joinWaitlist(BASE_INPUT);

    expect(duplicate.success).toBe(false);
    expect(duplicate.message).toMatch(/already on the waitlist/i);
  });

  it('allows the same user to join for a different vet', async () => {
    await joinWaitlist(BASE_INPUT);
    const r2 = await joinWaitlist({ ...BASE_INPUT, vetId: 'vet-2' });

    expect(r2.success).toBe(true);
    expect(r2.data.vetId).toBe('vet-2');
  });

  it('rejects missing required fields', async () => {
    const r = await joinWaitlist({ ...BASE_INPUT, vetId: '' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/required/i);
  });

  it('rejects invalid date strings', async () => {
    const r = await joinWaitlist({ ...BASE_INPUT, preferredDateStart: 'not-a-date' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/valid ISO/i);
  });

  it('rejects end date before start date', async () => {
    const r = await joinWaitlist({
      ...BASE_INPUT,
      preferredDateStart: '2026-07-31',
      preferredDateEnd: '2026-07-01',
    });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/on or after/i);
  });

  it('positions are independent per vet', async () => {
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-1', vetId: 'vet-A' });
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-2', vetId: 'vet-A' });
    const r = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1', vetId: 'vet-B' });

    // user-1 is first in vet-B's queue
    expect(r.data.position).toBe(1);
  });
});

// ─── leaveWaitlist ────────────────────────────────────────────────────────────

describe('leaveWaitlist()', () => {
  it('cancels a WAITING entry', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    const result = await leaveWaitlist(entry.id);

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(WaitlistStatus.CANCELLED);
  });

  it('recalculates positions after a user leaves', async () => {
    const { data: e1 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });
    const { data: e2 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });
    const { data: e3 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-3' });

    // user-2 (position 2) leaves
    await leaveWaitlist(e2.id);

    const pos1 = await getWaitlistPosition(e1.id);
    const pos3 = await getWaitlistPosition(e3.id);

    expect(pos1?.position).toBe(1);
    expect(pos3?.position).toBe(2); // moved up
  });

  it('returns error for non-existent entry', async () => {
    const result = await leaveWaitlist('does-not-exist');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  it('cannot cancel an already-cancelled entry', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    await leaveWaitlist(entry.id);
    const second = await leaveWaitlist(entry.id);

    expect(second.success).toBe(false);
    expect(second.message).toMatch(/CANCELLED/);
  });

  it('cannot cancel an ACCEPTED entry', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    await notifyNextInQueue('vet-1', '2026-07-15');
    await acceptSlot(entry.id, 'apt-123');

    const result = await leaveWaitlist(entry.id);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/ACCEPTED/);
  });

  it('rejects empty entryId', async () => {
    const result = await leaveWaitlist('   ');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/required/i);
  });
});

// ─── notifyNextInQueue ────────────────────────────────────────────────────────

describe('notifyNextInQueue()', () => {
  it('notifies the first WAITING user and sets NOTIFIED status', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);

    const notified = await notifyNextInQueue('vet-1', '2026-07-15');

    expect(notified).not.toBeNull();
    expect(notified!.id).toBe(entry.id);
    expect(notified!.status).toBe(WaitlistStatus.NOTIFIED);
    expect(notified!.notifiedAt).not.toBeNull();
    expect(notified!.acceptanceDeadline).not.toBeNull();
  });

  it('sets acceptanceDeadline to notifiedAt + 15 minutes', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    const notified = await notifyNextInQueue('vet-1', '2026-07-15');

    const notifiedAt = new Date(notified!.notifiedAt!).getTime();
    const deadline = new Date(notified!.acceptanceDeadline!).getTime();

    expect(deadline - notifiedAt).toBeCloseTo(ACCEPTANCE_WINDOW_MS, -2); // within 100ms
  });

  it('fires a push notification', async () => {
    await joinWaitlist(BASE_INPUT);
    await notifyNextInQueue('vet-1', '2026-07-15');

    expect(mockSendAlert).toHaveBeenCalledTimes(1);
    expect(mockSendAlert).toHaveBeenCalledWith(
      expect.stringContaining('Slot Available'),
      expect.stringContaining('2026-07-15'),
      expect.objectContaining({ type: 'waitlist', vetId: 'vet-1' }),
    );
  });

  it('respects FIFO order — notifies the earliest joiner first', async () => {
    // user-2 joins first (earlier createdAt), user-1 joins second
    const { data: e2 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });
    const { data: _e1 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });

    const notified = await notifyNextInQueue('vet-1', '2026-07-15');
    expect(notified!.id).toBe(e2.id);
  });

  it('skips users whose preferred window does not cover the slot date', async () => {
    // user-1 wants July, user-2 wants August
    await joinWaitlist({
      ...BASE_INPUT,
      userId: 'user-1',
      preferredDateStart: '2026-07-01',
      preferredDateEnd: '2026-07-31',
    });
    const { data: e2 } = await joinWaitlist({
      ...BASE_INPUT,
      userId: 'user-2',
      preferredDateStart: '2026-08-01',
      preferredDateEnd: '2026-08-31',
    });

    // Slot opens in August — user-1 should be skipped
    const notified = await notifyNextInQueue('vet-1', '2026-08-10');
    expect(notified!.id).toBe(e2.id);
  });

  it('returns null when the queue is empty', async () => {
    const result = await notifyNextInQueue('vet-1', '2026-07-15');
    expect(result).toBeNull();
  });

  it('returns null when no user covers the slot date', async () => {
    await joinWaitlist({
      ...BASE_INPUT,
      preferredDateStart: '2026-07-01',
      preferredDateEnd: '2026-07-31',
    });
    const result = await notifyNextInQueue('vet-1', '2026-09-01');
    expect(result).toBeNull();
  });

  it('returns null for empty vetId', async () => {
    const result = await notifyNextInQueue('', '2026-07-15');
    expect(result).toBeNull();
  });
});

// ─── acceptSlot ───────────────────────────────────────────────────────────────

describe('acceptSlot()', () => {
  it('accepts a NOTIFIED entry within the window', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    await notifyNextInQueue('vet-1', '2026-07-15');

    const result = await acceptSlot(entry.id, 'apt-abc');

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(WaitlistStatus.ACCEPTED);
    expect(result.data.appointmentId).toBe('apt-abc');
  });

  it('rejects acceptance after the 15-minute window has expired', async () => {
    jest.useFakeTimers();

    const { data: entry } = await joinWaitlist(BASE_INPUT);
    await notifyNextInQueue('vet-1', '2026-07-15');

    // Advance time past the acceptance window
    jest.advanceTimersByTime(ACCEPTANCE_WINDOW_MS + 1000);

    const result = await acceptSlot(entry.id, 'apt-late');

    expect(result.success).toBe(false);
    expect(result.data.status).toBe(WaitlistStatus.EXPIRED);
    expect(result.message).toMatch(/expired/i);

    jest.useRealTimers();
  });

  it('rejects acceptance for a WAITING (not yet notified) entry', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    const result = await acceptSlot(entry.id, 'apt-xyz');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/WAITING/);
  });

  it('rejects acceptance for a CANCELLED entry', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    await leaveWaitlist(entry.id);

    const result = await acceptSlot(entry.id, 'apt-xyz');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/CANCELLED/);
  });

  it('rejects missing entryId or appointmentId', async () => {
    const r1 = await acceptSlot('', 'apt-1');
    expect(r1.success).toBe(false);

    const r2 = await acceptSlot('entry-1', '');
    expect(r2.success).toBe(false);
  });

  it('returns error for non-existent entry', async () => {
    const result = await acceptSlot('ghost-id', 'apt-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });
});

// ─── processExpiredNotifications ─────────────────────────────────────────────

describe('processExpiredNotifications()', () => {
  it('expires stale NOTIFIED entries and cascades to the next user', async () => {
    jest.useFakeTimers();

    const { data: e1 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });
    const { data: e2 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });

    // Notify user-1
    await notifyNextInQueue('vet-1', '2026-07-15');

    // Advance past the acceptance window
    jest.advanceTimersByTime(ACCEPTANCE_WINDOW_MS + 5000);

    const expired = await processExpiredNotifications();

    expect(expired).toHaveLength(1);
    expect(expired[0].id).toBe(e1.id);
    expect(expired[0].status).toBe(WaitlistStatus.EXPIRED);

    // user-2 should now be notified
    const pos2 = await getWaitlistPosition(e2.id);
    expect(pos2?.status).toBe(WaitlistStatus.NOTIFIED);

    jest.useRealTimers();
  });

  it('returns empty array when no notifications have expired', async () => {
    await joinWaitlist(BASE_INPUT);
    await notifyNextInQueue('vet-1', '2026-07-15');

    // Do NOT advance time
    const expired = await processExpiredNotifications();
    expect(expired).toHaveLength(0);
  });

  it('handles an empty waitlist gracefully', async () => {
    const expired = await processExpiredNotifications();
    expect(expired).toHaveLength(0);
  });
});

// ─── Slot assignment fairness ─────────────────────────────────────────────────

describe('Slot assignment fairness (FIFO)', () => {
  it('assigns slots strictly in join order across multiple cancellations', async () => {
    jest.useFakeTimers();

    // 4 users join in order
    const { data: e1 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });
    const { data: e2 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });
    const { data: e3 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-3' });
    const { data: e4 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-4' });

    // Slot 1 opens → user-1 notified
    await notifyNextInQueue('vet-1', '2026-07-15');
    await acceptSlot(e1.id, 'apt-1');

    // Slot 2 opens → user-2 notified
    await notifyNextInQueue('vet-1', '2026-07-16');
    // user-2 lets window expire
    jest.advanceTimersByTime(ACCEPTANCE_WINDOW_MS + 1000);
    await processExpiredNotifications();

    // user-3 should now be notified (user-2 expired)
    const pos3 = await getWaitlistPosition(e3.id);
    expect(pos3?.status).toBe(WaitlistStatus.NOTIFIED);

    // user-3 accepts
    await acceptSlot(e3.id, 'apt-3');

    // Slot 3 opens → user-4 should be next
    const notified = await notifyNextInQueue('vet-1', '2026-07-17');
    expect(notified!.id).toBe(e4.id);

    jest.useRealTimers();
  });

  it('notifies the next WAITING user when a second slot opens while user-1 is still deciding', async () => {
    const { data: _e1 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });
    const { data: _e2 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });

    // Slot 1 opens → user-1 transitions to NOTIFIED (no longer WAITING)
    await notifyNextInQueue('vet-1', '2026-07-15');

    // Slot 2 opens while user-1 is still deciding.
    // user-1 is NOTIFIED (not WAITING), so the WAITING queue only has user-2.
    // user-2 should be notified for the second slot.
    const second = await notifyNextInQueue('vet-1', '2026-07-16');

    expect(second).not.toBeNull();
    expect(second!.userId).toBe('user-2');
  });
});

// ─── getUserWaitlistEntries ───────────────────────────────────────────────────

describe('getUserWaitlistEntries()', () => {
  it('returns all entries for a user sorted by createdAt desc', async () => {
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-1', vetId: 'vet-1' });
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-1', vetId: 'vet-2' });
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-2', vetId: 'vet-1' });

    const result = await getUserWaitlistEntries('user-1');

    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.data.every((e) => e.userId === 'user-1')).toBe(true);
  });

  it('returns empty list for unknown user', async () => {
    const result = await getUserWaitlistEntries('ghost-user');
    expect(result.success).toBe(true);
    expect(result.total).toBe(0);
  });

  it('returns failure for empty userId', async () => {
    const result = await getUserWaitlistEntries('');
    expect(result.success).toBe(false);
  });
});

// ─── getWaitlistPosition ──────────────────────────────────────────────────────

describe('getWaitlistPosition()', () => {
  it('returns position info for a valid entry', async () => {
    const { data: entry } = await joinWaitlist(BASE_INPUT);
    const info = await getWaitlistPosition(entry.id);

    expect(info).not.toBeNull();
    expect(info!.entryId).toBe(entry.id);
    expect(info!.position).toBe(1);
    expect(info!.status).toBe(WaitlistStatus.WAITING);
    expect(info!.estimatedWaitMinutes).toBeGreaterThan(0);
  });

  it('returns null for non-existent entry', async () => {
    const info = await getWaitlistPosition('ghost-id');
    expect(info).toBeNull();
  });

  it('returns null for empty entryId', async () => {
    const info = await getWaitlistPosition('');
    expect(info).toBeNull();
  });
});

// ─── getVetWaitlist ───────────────────────────────────────────────────────────

describe('getVetWaitlist()', () => {
  it('returns active entries for a vet in queue order', async () => {
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });
    await joinWaitlist({ ...BASE_INPUT, userId: 'user-3' });

    const result = await getVetWaitlist('vet-1');

    expect(result.success).toBe(true);
    expect(result.total).toBe(3);
    // Should be sorted by position
    expect(result.data[0].position).toBe(1);
    expect(result.data[1].position).toBe(2);
    expect(result.data[2].position).toBe(3);
  });

  it('excludes CANCELLED and ACCEPTED entries', async () => {
    const { data: e1 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-1' });
    const { data: e2 } = await joinWaitlist({ ...BASE_INPUT, userId: 'user-2' });

    await leaveWaitlist(e1.id);
    await notifyNextInQueue('vet-1', '2026-07-15');
    await acceptSlot(e2.id, 'apt-1');

    const result = await getVetWaitlist('vet-1');
    expect(result.total).toBe(0);
  });

  it('returns failure for empty vetId', async () => {
    const result = await getVetWaitlist('');
    expect(result.success).toBe(false);
  });
});

// ─── Timeout handling edge cases ──────────────────────────────────────────────

describe('Timeout handling', () => {
  it('acceptance window boundary: accepts exactly at deadline - 1ms', async () => {
    jest.useFakeTimers();

    const { data: entry } = await joinWaitlist(BASE_INPUT);
    await notifyNextInQueue('vet-1', '2026-07-15');

    // Advance to just before the deadline
    jest.advanceTimersByTime(ACCEPTANCE_WINDOW_MS - 1);

    const result = await acceptSlot(entry.id, 'apt-boundary');
    expect(result.success).toBe(true);

    jest.useRealTimers();
  });

  it('acceptance window boundary: rejects exactly at deadline + 1ms', async () => {
    jest.useFakeTimers();

    const { data: entry } = await joinWaitlist(BASE_INPUT);
    await notifyNextInQueue('vet-1', '2026-07-15');

    // Advance past the deadline
    jest.advanceTimersByTime(ACCEPTANCE_WINDOW_MS + 1);

    const result = await acceptSlot(entry.id, 'apt-too-late');
    expect(result.success).toBe(false);
    expect(result.data.status).toBe(WaitlistStatus.EXPIRED);

    jest.useRealTimers();
  });

  it('ACCEPTANCE_WINDOW_MS is exactly 15 minutes', () => {
    expect(ACCEPTANCE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
