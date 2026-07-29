import { useState, useEffect, useCallback } from 'react';

import type { Medication } from '../models/Medication';
import {
  getMedications as fetchMedications,
  saveMedication,
  deleteMedication,
} from '../services/medicationService';

export interface UseMedicationsReturn {
  medications: Medication[];
  isLoading: boolean;
  error: Error | null;
  add: (medication: Medication) => Promise<void>;
  update: (medication: Medication) => Promise<void>;
  remove: (id: string) => Promise<void>;
  getUpcomingReminders: (petId?: string, days?: number) => Medication[];
  refresh: () => Promise<void>;
}

export interface UseMedicationsOptions {
  petId?: string;
  autoRefresh?: boolean;
}

/**
 * Custom hook for managing pet medications with optimistic updates.
 * 
 * @param options - Configuration options
 * @param options.petId - Filter medications by pet ID
 * @param options.autoRefresh - Automatically refresh on mount (default: true)
 * 
 * @returns Medications state and CRUD operations
 * 
 * @example
 * const { medications, isLoading, add, update, remove } = useMedications({ petId: 'pet-123' });
 */
export function useMedications(options: UseMedicationsOptions = {}): UseMedicationsReturn {
  const { petId, autoRefresh = true } = options;

  const [medications, setMedications] = useState<Medication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load medications from database
  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const allMedications = await fetchMedications();
      
      // Filter by petId if provided
      const filtered = petId
        ? allMedications.filter((med) => med.petId === petId)
        : allMedications;
      
      setMedications(filtered);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load medications'));
    } finally {
      setIsLoading(false);
    }
  }, [petId]);

  // Load on mount
  useEffect(() => {
    if (autoRefresh) {
      refresh();
    }
  }, [refresh, autoRefresh]);

  // Add medication with optimistic update
  const add = useCallback(
    async (medication: Medication) => {
      // Optimistic update
      setMedications((prev) => [...prev, medication]);
      
      try {
        await saveMedication(medication);
      } catch (err) {
        // Rollback on error
        setMedications((prev) => prev.filter((m) => m.id !== medication.id));
        setError(err instanceof Error ? err : new Error('Failed to add medication'));
        throw err;
      }
    },
    [],
  );

  // Update medication with optimistic update
  const update = useCallback(
    async (medication: Medication) => {
      // Store previous state for rollback
      const previous = medications.find((m) => m.id === medication.id);
      
      // Optimistic update
      setMedications((prev) =>
        prev.map((m) => (m.id === medication.id ? medication : m)),
      );
      
      try {
        await saveMedication(medication);
      } catch (err) {
        // Rollback on error
        if (previous) {
          setMedications((prev) =>
            prev.map((m) => (m.id === medication.id ? previous : m)),
          );
        }
        setError(err instanceof Error ? err : new Error('Failed to update medication'));
        throw err;
      }
    },
    [medications],
  );

  // Remove medication with optimistic update
  const remove = useCallback(
    async (id: string) => {
      // Store previous state for rollback
      const previous = medications.find((m) => m.id === id);
      
      // Optimistic update
      setMedications((prev) => prev.filter((m) => m.id !== id));
      
      try {
        await deleteMedication(id);
      } catch (err) {
        // Rollback on error
        if (previous) {
          setMedications((prev) => [...prev, previous]);
        }
        setError(err instanceof Error ? err : new Error('Failed to delete medication'));
        throw err;
      }
    },
    [medications],
  );

  // Get upcoming reminders within specified days
  const getUpcomingReminders = useCallback(
    (filterPetId?: string, days = 7): Medication[] => {
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(now.getDate() + days);

      return medications.filter((med) => {
        // Filter by petId if provided
        if (filterPetId && med.petId !== filterPetId) {
          return false;
        }

        // Check if medication is active
        if (med.status === 'paused' || med.status === 'discontinued') {
          return false;
        }

        // Check if medication has upcoming doses
        const startDate = new Date(med.startDate);
        if (startDate > futureDate) {
          return false;
        }

        // Check if medication ends before the future date
        if (med.endDate) {
          const endDate = new Date(med.endDate);
          if (endDate < now) {
            return false;
          }
        }

        return true;
      });
    },
    [medications],
  );

  return {
    medications,
    isLoading,
    error,
    add,
    update,
    remove,
    getUpcomingReminders,
    refresh,
  };
}
