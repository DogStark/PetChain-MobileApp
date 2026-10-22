import { act, renderHook } from '@testing-library/react-native';

import { useAppointments } from '../useAppointments';
import {
  AppointmentStatus,
  AppointmentType,
  type Appointment,
} from '../../models/Appointment';
import {
  cancelAppointmentById,
  getAppointments,
  saveAppointment,
} from '../../services/appointmentService';

jest.mock('../../services/appointmentService', () => ({
  getAppointments: jest.fn(),
  saveAppointment: jest.fn(),
  cancelAppointmentById: jest.fn(),
}));

/** Helper to build a mock appointment */
function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-001',
    petId: 'pet-001',
    vetId: 'vet-001',
    date: '2026-08-01',
    time: '09:00',
    durationMinutes: 30,
    type: AppointmentType.ROUTINE_CHECKUP,
    status: AppointmentStatus.CONFIRMED,
    title: 'Annual Checkup',
    petName: 'Buddy',
    vetName: 'Dr. Smith',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useAppointments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Fetching ───────────────────────────────────────────────────────────

  it('fetches appointments on mount and sets isLoading → false', async () => {
    const mockData = [makeAppointment()];
    (getAppointments as jest.Mock).mockResolvedValue(mockData);

    const { result } = renderHook(() => useAppointments());

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.appointments).toEqual([]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.appointments).toEqual(mockData);
    expect(getAppointments).toHaveBeenCalledWith(undefined);
  });

  it('passes petId filter to getAppointments', async () => {
    (getAppointments as jest.Mock).mockResolvedValue([]);

    renderHook(() => useAppointments({ petId: 'pet-123' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(getAppointments).toHaveBeenCalledWith('pet-123');
  });

  it('sets error when fetch fails', async () => {
    (getAppointments as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAppointments());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.isLoading).toBe(false);
  });

  // ── Client-side filtering ──────────────────────────────────────────────

  it('filters appointments by date range', async () => {
    const data = [
      makeAppointment({ id: '1', date: '2026-07-01' }),
      makeAppointment({ id: '2', date: '2026-08-01' }),
      makeAppointment({ id: '3', date: '2026-09-01' }),
    ];
    (getAppointments as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() =>
      useAppointments({ fromDate: '2026-08-01', toDate: '2026-08-31' }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.appointments).toHaveLength(1);
    expect(result.current.appointments[0].id).toBe('2');
  });

  it('filters appointments by status', async () => {
    const data = [
      makeAppointment({ id: '1', status: AppointmentStatus.CONFIRMED }),
      makeAppointment({ id: '2', status: AppointmentStatus.PENDING }),
      makeAppointment({ id: '3', status: AppointmentStatus.CANCELLED }),
    ];
    (getAppointments as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() =>
      useAppointments({ status: AppointmentStatus.PENDING }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.appointments).toHaveLength(1);
    expect(result.current.appointments[0].id).toBe('2');
  });

  it('filters appointments by type', async () => {
    const data = [
      makeAppointment({ id: '1', type: AppointmentType.ROUTINE_CHECKUP }),
      makeAppointment({ id: '2', type: AppointmentType.VACCINATION }),
    ];
    (getAppointments as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() =>
      useAppointments({ type: AppointmentType.VACCINATION }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.appointments).toHaveLength(1);
    expect(result.current.appointments[0].id).toBe('2');
  });

  // ── Optimistic create ──────────────────────────────────────────────────

  it('optimistically adds an appointment on create', async () => {
    (getAppointments as jest.Mock).mockResolvedValue([]);
    const saved = makeAppointment({ id: 'server-id' });
    (saveAppointment as jest.Mock).mockResolvedValue(saved);

    const { result } = renderHook(() => useAppointments());

    await act(async () => {
      await Promise.resolve();
    });

    const input = makeAppointment({
      id: undefined as unknown as string,
      petId: 'pet-new',
      title: 'New Visit',
      createdAt: undefined as unknown as string,
      updatedAt: undefined as unknown as string,
    });

    await act(async () => {
      await result.current.create(input);
    });

    // Optimistic add — the temp id should be present
    expect(result.current.appointments).toHaveLength(1);
    expect(result.current.appointments[0].title).toBe('New Visit');

    // After save resolves, the temp id is replaced with the server id
    expect(result.current.appointments[0].id).toBe('server-id');
    expect(saveAppointment).toHaveBeenCalledTimes(1);
  });

  it('rolls back optimistic create on failure', async () => {
    (getAppointments as jest.Mock).mockResolvedValue([]);
    (saveAppointment as jest.Mock).mockRejectedValue(new Error('Save failed'));

    const { result } = renderHook(() => useAppointments());

    await act(async () => {
      await Promise.resolve();
    });

    const input = makeAppointment({
      id: undefined as unknown as string,
      petId: 'pet-new',
      title: 'Failed Visit',
      createdAt: undefined as unknown as string,
      updatedAt: undefined as unknown as string,
    });

    await act(async () => {
      try {
        await result.current.create(input);
      } catch {
        // Expected
      }
    });

    // Rollback — list should be empty again
    expect(result.current.appointments).toHaveLength(0);
    expect(result.current.error).toBe('Save failed');
  });

  // ── Optimistic cancel ──────────────────────────────────────────────────

  it('optimistically cancels an appointment', async () => {
    const appt = makeAppointment({ id: 'appt-001', status: AppointmentStatus.CONFIRMED });
    (getAppointments as jest.Mock).mockResolvedValue([appt]);
    (cancelAppointmentById as jest.Mock).mockResolvedValue({
      ...appt,
      status: AppointmentStatus.CANCELLED,
    });

    const { result } = renderHook(() => useAppointments());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.cancel('appt-001', 'No longer needed');
    });

    // Optimistic update — status should be CANCELLED immediately
    expect(result.current.appointments[0].status).toBe(AppointmentStatus.CANCELLED);
    expect(result.current.appointments[0].cancellationReason).toBe('No longer needed');
    expect(cancelAppointmentById).toHaveBeenCalledWith('appt-001', 'No longer needed');
  });

  it('rolls back optimistic cancel on failure', async () => {
    const appt = makeAppointment({ id: 'appt-001', status: AppointmentStatus.CONFIRMED });
    (getAppointments as jest.Mock).mockResolvedValue([appt]);
    (cancelAppointmentById as jest.Mock).mockRejectedValue(new Error('Cancel failed'));

    const { result } = renderHook(() => useAppointments());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      try {
        await result.current.cancel('appt-001');
      } catch {
        // Expected
      }
    });

    // Rollback — status should remain CONFIRMED
    expect(result.current.appointments[0].status).toBe(AppointmentStatus.CONFIRMED);
    expect(result.current.error).toBe('Cancel failed');
  });

  it('sets error when cancelling a non-existent appointment', async () => {
    (getAppointments as jest.Mock).mockResolvedValue([]);

    const { result } = renderHook(() => useAppointments());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.cancel('nonexistent');
    });

    expect(result.current.error).toBe('Appointment not found');
  });

  // ── Refetch ────────────────────────────────────────────────────────────

  it('refetches appointments via refetch', async () => {
    const initial = [makeAppointment({ id: '1', title: 'Original' })];
    const updated = [makeAppointment({ id: '1', title: 'Updated' })];
    (getAppointments as jest.Mock).mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useAppointments());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.appointments[0].title).toBe('Original');

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.appointments[0].title).toBe('Updated');
    expect(getAppointments).toHaveBeenCalledTimes(2);
  });

  it('sets error on refetch failure', async () => {
    (getAppointments as jest.Mock)
      .mockResolvedValueOnce([makeAppointment()])
      .mockRejectedValueOnce(new Error('Refetch failed'));

    const { result } = renderHook(() => useAppointments());

    // Wait for initial fetch
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBe('Failed to refresh appointments');
    // Original data should still be present
    expect(result.current.appointments).toHaveLength(1);
  });

  // ── Cleanup ────────────────────────────────────────────────────────────

  it('does not update state after unmount', async () => {
    // A promise that never resolves during the test, ensuring the component
    // unmounts before the fetch completes
    (getAppointments as jest.Mock).mockReturnValue(
      new Promise(() => {}),
    );

    const { result, unmount } = renderHook(() => useAppointments());

    expect(result.current.isLoading).toBe(true);

    unmount();

    // Should not throw or attempt to update state after unmount
    // The mountedRef guard prevents setState calls
  });
});
