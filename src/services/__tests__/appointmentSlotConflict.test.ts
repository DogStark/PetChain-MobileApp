import {
  bookAppointmentWithConflictHandling,
  type BookAppointmentRequest,
} from '../appointmentService';
import { upsertAppointment } from '../localDB';
import apiClient from '../apiClient';

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('../localDB', () => ({
  getAllLocalAppointments: jest.fn(),
  getAllAppointmentsByPetId: jest.fn(),
  getAppointmentsInWindow: jest.fn(),
  upsertAppointment: jest.fn(),
  deleteAppointmentById: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const mockPost = jest.mocked(apiClient).post as jest.Mock;
const mockGet = jest.mocked(apiClient).get as jest.Mock;
const mockUpsert = upsertAppointment as jest.Mock;

const baseReq: BookAppointmentRequest = {
  petId: 'pet-1',
  vetId: 'vet-1',
  date: '2026-09-01',
  time: '10:00',
  title: 'Dental cleaning',
  location: 'Downtown Clinic',
  vetName: 'Dr. Synthetic',
  notes: 'Nervous around strangers',
  durationMinutes: 30,
  idempotencyKey: 'attempt-abc-123',
};

const conflict409 = Object.assign(new Error('Conflict'), { response: { status: 409 } });

beforeEach(() => jest.clearAllMocks());

describe('bookAppointmentWithConflictHandling (#961)', () => {
  it('books normally and persists locally when the slot is free', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { id: 'a1', ...baseReq } } });

    const result = await bookAppointmentWithConflictHandling(baseReq);

    expect(result.status).toBe('booked');
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('sends the idempotency key as a header so retries cannot double-book', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { id: 'a1' } } });

    await bookAppointmentWithConflictHandling(baseReq);

    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ headers: { 'Idempotency-Key': 'attempt-abc-123' } }),
    );
  });

  it('on 409 refreshes alternative slots and preserves safe form inputs', async () => {
    mockPost.mockRejectedValueOnce(conflict409);
    mockGet.mockResolvedValueOnce({
      data: {
        data: { vetId: 'vet-1', date: '2026-09-01', availableSlots: ['10:00', '10:30', '11:00'] },
      },
    });

    const result = await bookAppointmentWithConflictHandling(baseReq);

    if (result.status !== 'conflict') throw new Error('expected conflict');
    expect(result.alternatives).toEqual(['10:30', '11:00']); // conflicted 10:00 removed
    expect(result.preservedInput).toMatchObject({
      petId: 'pet-1',
      title: 'Dental cleaning',
      location: 'Downtown Clinic',
      vetName: 'Dr. Synthetic',
      notes: 'Nervous around strangers',
      date: '2026-09-01',
    });
    // The dead time is not carried back into the form.
    expect((result.preservedInput as Record<string, unknown>).time).toBeUndefined();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('still returns a usable conflict result when availability lookup fails', async () => {
    mockPost.mockRejectedValueOnce(conflict409);
    mockGet.mockRejectedValueOnce(new Error('offline'));

    const result = await bookAppointmentWithConflictHandling(baseReq);

    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') expect(result.alternatives).toEqual([]);
  });

  it('rethrows non-409 errors so existing handling applies', async () => {
    mockPost.mockRejectedValueOnce(
      Object.assign(new Error('Server error'), { response: { status: 500 } }),
    );

    await expect(bookAppointmentWithConflictHandling(baseReq)).rejects.toThrow('Server error');
  });
});
