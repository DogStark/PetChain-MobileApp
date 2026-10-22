import {
  getAppointments,
  saveAppointment,
  deleteAppointment,
  getUpcoming,
  getPast,
  scheduleAppointmentReminder,
  cancelAppointmentReminder,
  scheduleAppointmentReminders,
  cancelAllAppointmentReminders,
  getAvailability,
  checkConflicts,
  cancelAppointmentById,
  rescheduleAppointment,
  detectConflicts,
  CONFLICT_BUFFER_MS,
  type Appointment,
} from '../appointmentService';
import { getItem, setItem, getAllLocalAppointments, getAppointmentsInWindow, upsertAppointment } from '../localDB';
import apiClient from '../apiClient';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../localDB', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  getAllLocalAppointments: jest.fn(),
  getAllAppointmentsByPetId: jest.fn(),
  getAppointmentsInWindow: jest.fn(),
  upsertAppointment: jest.fn(),
  deleteAppointmentById: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const mockGetItem = getItem as jest.MockedFunction<typeof getItem>;
const mockSetItem = setItem as jest.MockedFunction<typeof setItem>;
const mockClient = jest.mocked(apiClient);
const mockApiGet = mockClient.get as jest.Mock;
const mockApiPost = mockClient.post as jest.Mock;
const mockApiPut = mockClient.put as jest.Mock;
const mockApiDelete = mockClient.delete as jest.Mock;
const mockGetAllLocalAppointments = getAllLocalAppointments as jest.Mock;
const mockGetAppointmentsInWindow = getAppointmentsInWindow as jest.Mock;
const mockUpsertAppointment = upsertAppointment as jest.Mock;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const future = new Date(Date.now() + 86_400_000).toISOString(); // tomorrow
const past = new Date(Date.now() - 86_400_000).toISOString(); // yesterday

const appt1: Appointment = {
  id: 'a1',
  petId: 'p1',
  petName: 'Buddy',
  title: 'Annual checkup',
  date: future,
  status: 'upcoming',
};

const appt2: Appointment = {
  id: 'a2',
  petId: 'p1',
  petName: 'Buddy',
  title: 'Vaccination',
  date: past,
  status: 'completed',
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

describe('getAppointments', () => {
  it('returns empty array when nothing stored', async () => {
    mockGetItem.mockResolvedValue(null);
    expect(await getAppointments()).toEqual([]);
  });

  it('parses stored JSON', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify([appt1]));
    expect(await getAppointments()).toEqual([appt1]);
  });

  it('returns empty array on malformed JSON', async () => {
    mockGetItem.mockResolvedValue('not-json');
    expect(await getAppointments()).toEqual([]);
  });
});

describe('saveAppointment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('appends a new appointment', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify([appt1]));
    await saveAppointment(appt2);
    expect(mockSetItem).toHaveBeenCalledWith('@appointments', JSON.stringify([appt1, appt2]));
  });

  it('updates an existing appointment by id', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify([appt1]));
    const updated = { ...appt1, title: 'Updated checkup' };
    await saveAppointment(updated);
    expect(mockSetItem).toHaveBeenCalledWith('@appointments', JSON.stringify([updated]));
  });
});

describe('deleteAppointment', () => {
  it('removes the appointment with the given id', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify([appt1, appt2]));
    await deleteAppointment('a1');
    expect(mockSetItem).toHaveBeenCalledWith('@appointments', JSON.stringify([appt2]));
  });
});

// ─── Derived views ────────────────────────────────────────────────────────────

describe('getUpcoming', () => {
  it('returns only upcoming appointments with future dates', () => {
    const result = getUpcoming([appt1, appt2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('excludes upcoming appointments with past dates', () => {
    const stale: Appointment = { ...appt1, date: past };
    expect(getUpcoming([stale])).toHaveLength(0);
  });

  it('sorts ascending by date', () => {
    const soon: Appointment = {
      ...appt1,
      id: 'a3',
      date: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const later: Appointment = {
      ...appt1,
      id: 'a4',
      date: new Date(Date.now() + 7_200_000).toISOString(),
    };
    const result = getUpcoming([later, soon]);
    expect(result[0].id).toBe('a3');
  });
});

describe('getPast', () => {
  it('returns completed and cancelled appointments', () => {
    const cancelled: Appointment = { ...appt1, id: 'a5', status: 'cancelled' };
    const result = getPast([appt1, appt2, cancelled]);
    const ids = result.map((a) => a.id);
    expect(ids).toContain('a2');
    expect(ids).toContain('a5');
    expect(ids).not.toContain('a1');
  });

  it('sorts descending by date', () => {
    const older: Appointment = {
      ...appt2,
      id: 'a6',
      date: new Date(Date.now() - 172_800_000).toISOString(),
    };
    const result = getPast([older, appt2]);
    expect(result[0].id).toBe('a2');
  });
});

// ─── Notification helpers ─────────────────────────────────────────────────────

describe('scheduleAppointmentReminder', () => {
  it('returns null for past appointments', async () => {
    const result = await scheduleAppointmentReminder({ ...appt1, date: past });
    expect(result).toBeNull();
  });

  it('schedules and returns a notification id for future appointments', async () => {
    const result = await scheduleAppointmentReminder(appt1);
    expect(result).toBe('notif-id');
  });
});

describe('cancelAppointmentReminder', () => {
  it('calls cancelScheduledNotificationAsync with the given id', async () => {
    await cancelAppointmentReminder('notif-id');
    const N = jest.requireMock('expo-notifications') as typeof import('expo-notifications');
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-id');
  });
});

// ─── API-based functions (axios mocked) ──────────────────────────────────────

describe('getAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches available slots from the API', async () => {
    const slots = ['09:00', '10:00', '11:00'];
    mockApiGet.mockResolvedValueOnce({
      data: { data: { vetId: 'v1', date: '2026-07-20', availableSlots: slots } },
    });

    const result = await getAvailability('v1', '2026-07-20');

    expect(mockApiGet).toHaveBeenCalledWith('/appointments/availability', {
      params: { vetId: 'v1', date: '2026-07-20' },
    });
    expect(result.availableSlots).toEqual(slots);
    expect(result.vetId).toBe('v1');
  });

  it('propagates API errors', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('Network error'));
    await expect(getAvailability('v1', '2026-07-20')).rejects.toThrow('Network error');
  });
});

describe('checkConflicts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns conflict check from API', async () => {
    const conflictResponse = { conflicts: [], canSave: true, hasWarning: false, reason: null };
    mockApiPost.mockResolvedValueOnce({ data: { data: conflictResponse } });

    const result = await checkConflicts('p1', 'v1', '2026-07-20', '10:00');

    expect(mockApiPost).toHaveBeenCalledWith('/appointments/check-conflicts', {
      petId: 'p1', vetId: 'v1', date: '2026-07-20', time: '10:00',
      durationMinutes: 30, excludeId: undefined,
    });
    expect(result.canSave).toBe(true);
  });

  it('returns safe defaults when API call fails', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Server error'));

    const result = await checkConflicts('p1', 'v1', '2026-07-20', '10:00');

    expect(result).toEqual({ conflicts: [], canSave: true, hasWarning: false, reason: null });
  });

  it('passes excludeId when provided', async () => {
    mockApiPost.mockResolvedValueOnce({
      data: { data: { conflicts: [], canSave: true, hasWarning: false, reason: null } },
    });

    await checkConflicts('p1', 'v1', '2026-07-20', '10:00', 45, 'existing-id');

    expect(mockApiPost).toHaveBeenCalledWith('/appointments/check-conflicts', {
      petId: 'p1', vetId: 'v1', date: '2026-07-20', time: '10:00',
      durationMinutes: 45, excludeId: 'existing-id',
    });
  });
});
describe('cancelAppointmentById', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls cancel endpoint and updates local DB', async () => {
    const cancelledAppt = { ...appt1, status: 'CANCELLED' };
    mockApiPost.mockResolvedValueOnce({ data: { data: cancelledAppt } });

    const result = await cancelAppointmentById('a1', 'Owner request');

    expect(mockApiPost).toHaveBeenCalledWith('/appointments/a1/cancel', { reason: 'Owner request' });
    expect(mockUpsertAppointment).toHaveBeenCalledWith(cancelledAppt);
    expect(result).toEqual(cancelledAppt);
  });

  it('falls back to local update when API fails and appointment exists locally', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Offline'));
    mockGetAllLocalAppointments.mockResolvedValueOnce([appt1]);

    const result = await cancelAppointmentById('a1', 'Offline cancel');

    expect(mockUpsertAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', status: 'CANCELLED', cancellationReason: 'Offline cancel' }),
    );
    expect(result.id).toBe('a1');
    expect(result.status).toBe('CANCELLED');
  });

  it('throws if API fails and appointment not found locally', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Offline'));
    mockGetAllLocalAppointments.mockResolvedValueOnce([]);
    await expect(cancelAppointmentById('a1')).rejects.toThrow('Appointment not found');
  });
});

describe('rescheduleAppointment', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls reschedule endpoint and updates local DB', async () => {
    const rescheduledAppt = { ...appt1, date: '2026-07-25', status: 'RESCHEDULED' };
    mockApiPost.mockResolvedValueOnce({ data: { data: rescheduledAppt } });

    const result = await rescheduleAppointment('a1', '2026-07-25', '14:00', 45);

    expect(mockApiPost).toHaveBeenCalledWith('/appointments/a1/reschedule', {
      date: '2026-07-25', time: '14:00', durationMinutes: 45,
    });
    expect(mockUpsertAppointment).toHaveBeenCalledWith(rescheduledAppt);
    expect(result).toEqual(rescheduledAppt);
  });

  it('falls back to local update when API fails', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Offline'));
    mockGetAllLocalAppointments.mockResolvedValueOnce([appt1]);

    const result = await rescheduleAppointment('a1', '2026-07-25', '14:00');

    expect(mockUpsertAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', date: '2026-07-25', status: 'RESCHEDULED' }),
    );
    expect(result.status).toBe('RESCHEDULED');
  });
});

// ─── scheduleAppointmentReminders (plural) ──────────────────────────────────

describe('scheduleAppointmentReminders', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('schedules both 24h and 1h reminders for a future appointment', async () => {
    const futureAppt: Appointment = { ...appt1, date: '2026-07-20', time: '10:00' };
    const N = jest.requireMock('expo-notifications') as typeof import('expo-notifications');
    (N.scheduleNotificationAsync as jest.Mock).mockResolvedValue('notif-id');

    const [notif24h, notif1h] = await scheduleAppointmentReminders(futureAppt);

    expect(notif24h).toBe('notif-id');
    expect(notif1h).toBe('notif-id');
  });

  it('returns nulls for a past appointment', async () => {
    const pastAppt: Appointment = { ...appt1, date: '2020-01-01', time: '10:00' };

    const [notif24h, notif1h] = await scheduleAppointmentReminders(pastAppt);

    expect(notif24h).toBeNull();
    expect(notif1h).toBeNull();
  });
});

describe('cancelAllAppointmentReminders', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('cancels 24h, 1h, and legacy reminders', async () => {
    await cancelAllAppointmentReminders('a1');

    const N = jest.requireMock('expo-notifications') as typeof import('expo-notifications');
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a1-24h');
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a1-1h');
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a1');
  });
});

// ─── detectConflicts ────────────────────────────────────────────────────────

describe('detectConflicts', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns no conflicts when no overlapping appointments exist', async () => {
    mockGetAppointmentsInWindow.mockResolvedValueOnce([]);

    const result = await detectConflicts('p1', new Date(Date.now() + 86_400_000));

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
    expect(result.suggestedTime).toBeUndefined();
  });

  it('detects a conflict when an appointment is within the buffer window', async () => {
    const proposedTime = new Date('2026-07-20T10:00:00.000Z');
    const conflictingAppt: Appointment = {
      id: 'conflict-1', petId: 'p1', petName: 'Buddy',
      title: 'Vet Visit',
      date: new Date(proposedTime.getTime() + 30 * 60_000).toISOString(),
      status: 'upcoming',
    };
    mockGetAppointmentsInWindow.mockResolvedValueOnce([conflictingAppt]);

    const result = await detectConflicts('p1', proposedTime);

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].type).toBe('appointment');
    expect(result.conflicts[0].conflictingAppointment?.id).toBe('conflict-1');
  });

  it('skips excluded appointment when checking conflicts', async () => {
    const proposedTime = new Date('2026-07-20T10:00:00.000Z');
    const conflictingAppt: Appointment = {
      id: 'exclude-me', petId: 'p1', petName: 'Buddy',
      title: 'Self',
      date: new Date(proposedTime.getTime() + 30 * 60_000).toISOString(),
      status: 'upcoming',
    };
    mockGetAppointmentsInWindow.mockResolvedValueOnce([conflictingAppt]);

    const result = await detectConflicts('p1', proposedTime, [], 'exclude-me');

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });
});

