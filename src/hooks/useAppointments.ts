import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AppointmentStatus,
  type Appointment,
  type AppointmentFilters,
} from '../models/Appointment';
import {
  cancelAppointmentById,
  getAppointments,
  saveAppointment,
} from '../services/appointmentService';

/** Return type for the useAppointments hook */
export interface UseAppointmentsReturn {
  /** Filtered list of appointments */
  appointments: Appointment[];
  /** True during the initial fetch or a refetch */
  isLoading: boolean;
  /** The most recent error message, or null */
  error: string | null;
  /**
   * Create a new appointment with an optimistic update.
   * The appointment is added to the list immediately and rolled back on failure.
   */
  create: (appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  /**
   * Cancel an appointment with an optimistic update.
   * The status is updated to CANCELLED immediately and rolled back on failure.
   */
  cancel: (id: string, reason?: string) => Promise<void>;
  /** Re-fetch appointments from the backend */
  refetch: () => Promise<void>;
}

/**
 * useAppointments
 *
 * React hook to manage appointment fetching, filtering, and mutations
 * with optimistic updates.
 *
 * @param filters - Optional filters (petId, date range, status, type)
 * @returns {UseAppointmentsReturn}
 */
export function useAppointments(filters?: AppointmentFilters): UseAppointmentsReturn {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ── Apply client-side filters ─────────────────────────────────────────────

  const applyFilters = useCallback(
    (list: Appointment[]): Appointment[] => {
      let filtered = list;

      if (filters?.fromDate) {
        filtered = filtered.filter(
          (a) => a.date >= filters.fromDate!,
        );
      }
      if (filters?.toDate) {
        filtered = filtered.filter(
          (a) => a.date <= filters.toDate!,
        );
      }
      if (filters?.status) {
        const statuses = Array.isArray(filters.status)
          ? filters.status
          : [filters.status];
        filtered = filtered.filter((a) => statuses.includes(a.status));
      }
      if (filters?.type) {
        const types = Array.isArray(filters.type)
          ? filters.type
          : [filters.type];
        filtered = filtered.filter((a) => types.includes(a.type));
      }
      if (filters?.vetId) {
        filtered = filtered.filter((a) => a.vetId === filters.vetId);
      }

      return filtered;
    },
    [filters?.fromDate, filters?.toDate, filters?.status, filters?.type, filters?.vetId],
  );

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchAppointments = useCallback(async () => {
    setError(null);
    try {
      const data = await getAppointments(filters?.petId);
      if (!mountedRef.current) return;
      setAppointments(applyFilters(data));
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : 'Failed to load appointments';
      setError(message);
    }
  }, [filters?.petId, applyFilters]);

  // ── Create (optimistic) ──────────────────────────────────────────────────

  const create = useCallback(
    async (input: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>) => {
      setError(null);

      // Build an optimistic appointment with a temporary id
      const optimistic: Appointment = {
        ...input,
        id: `temp-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: input.status ?? AppointmentStatus.PENDING,
      };

      const tempId = optimistic.id;

      // Optimistically add to state (functional updater so concurrent
      // mutations are not lost)
      setAppointments((prev) => applyFilters([optimistic, ...prev]));

      try {
        const saved = await saveAppointment(input as Appointment & { id?: string });
        if (!mountedRef.current) return;
        // Replace the optimistic appointment with the server response
        setAppointments((prev) =>
          applyFilters(prev.map((a) => (a.id === tempId ? saved : a))),
        );
      } catch (err) {
        if (!mountedRef.current) return;
        // Rollback — only remove our optimistic entry, leaving other state intact
        setAppointments((prev) => applyFilters(prev.filter((a) => a.id !== tempId)));
        const message =
          err instanceof Error ? err.message : 'Failed to create appointment';
        setError(message);
        throw err;
      }
    },
    [applyFilters],
  );

  // ── Cancel (optimistic) ──────────────────────────────────────────────────

  const cancel = useCallback(
    async (id: string, reason?: string) => {
      setError(null);

      // Capture the original status before the optimistic update so we can
      // roll back precisely without overwriting concurrent mutations.
      const originalStatus = appointments.find((a) => a.id === id)?.status;
      if (!originalStatus) {
        setError('Appointment not found');
        return;
      }

      // Optimistically mark as cancelled
      setAppointments((prev) =>
        applyFilters(
          prev.map((a) =>
            a.id === id
              ? { ...a, status: AppointmentStatus.CANCELLED, cancellationReason: reason }
              : a,
          ),
        ),
      );

      try {
        await cancelAppointmentById(id, reason);
        // State is already updated optimistically — no need to replace
      } catch (err) {
        if (!mountedRef.current) return;
        // Rollback — restore only the original status, leaving other state intact
        setAppointments((prev) =>
          applyFilters(
            prev.map((a) =>
              a.id === id
                ? { ...a, status: originalStatus, cancellationReason: undefined }
                : a,
            ),
          ),
        );
        const message =
          err instanceof Error ? err.message : 'Failed to cancel appointment';
        setError(message);
        throw err;
      }
    },
    [appointments, applyFilters],
  );

  // ── Refetch ──────────────────────────────────────────────────────────────

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getAppointments(filters?.petId);
      if (!mountedRef.current) return;
      setAppointments(applyFilters(data));
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : 'Failed to refresh appointments';
      setError(message);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [filters?.petId, applyFilters]);

  // ── Initial fetch + cleanup ──────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);

    fetchAppointments().finally(() => {
      if (mountedRef.current) setIsLoading(false);
    });

    return () => {
      mountedRef.current = false;
    };
  }, [fetchAppointments]);

  return { appointments, isLoading, error, create, cancel, refetch };
}

export default useAppointments;
