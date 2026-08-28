/**
 * PetContext — Issue #151/#82: Multiple pets support
 *
 * Provides:
 *  - A list of all pets for the current user
 *  - The currently "active" pet (selected in the pet selector)
 *  - Per-pet settings stored in AsyncStorage
 *  - Aggregate helpers (e.g. total medication count across all pets)
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getItem, setItem } from '../services/localDB';
import { getAllPets, type Pet } from '../services/petService';

// ─── Per-pet settings ─────────────────────────────────────────────────────────

export interface PetSettings {
  notificationsEnabled: boolean;
  reminderLeadMinutes: number; // minutes before appointment/medication to remind
  weightUnit: 'kg' | 'lbs';
  notes: string;
}

const DEFAULT_PET_SETTINGS: PetSettings = {
  notificationsEnabled: true,
  reminderLeadMinutes: 60,
  weightUnit: 'kg',
  notes: '',
};

const PET_SETTINGS_KEY = (petId: string) => `@pet_settings_${petId}`;

// ─── Context shape ────────────────────────────────────────────────────────────

interface PetContextValue {
  /** All pets belonging to the current user */
  pets: Pet[];
  /** The pet currently selected in the pet selector (null = none / loading) */
  activePet: Pet | null;
  /** Whether the pet list is being fetched */
  loading: boolean;
  /** Last fetch error, if any */
  error: Error | null;
  /** Switch the active pet */
  setActivePet: (pet: Pet) => void;
  /** Reload pets from the API / cache */
  refreshPets: () => Promise<void>;
  /** Per-pet settings */
  getPetSettings: (petId: string) => Promise<PetSettings>;
  updatePetSettings: (petId: string, patch: Partial<PetSettings>) => Promise<void>;
  /** Aggregate: total number of pets */
  totalPets: number;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const PetContext = createContext<PetContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export const PetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pets, setPets] = useState<Pet[]>([]);
  const [activePet, setActivePetState] = useState<Pet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refreshPets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAllPets();
      setPets(data);
      // Auto-select first pet if none selected yet
      setActivePetState((prev) => {
        if (prev) {
          // Keep selection if the pet still exists
          const still = data.find((p) => p.id === prev.id);
          return still ?? data[0] ?? null;
        }
        return data[0] ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load pets'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPets();
  }, [refreshPets]);

  const setActivePet = useCallback((pet: Pet) => {
    setActivePetState(pet);
  }, []);

  const getPetSettings = useCallback(async (petId: string): Promise<PetSettings> => {
    const raw = await getItem(PET_SETTINGS_KEY(petId));
    if (!raw) return { ...DEFAULT_PET_SETTINGS };
    return { ...DEFAULT_PET_SETTINGS, ...JSON.parse(raw) };
  }, []);

  const updatePetSettings = useCallback(
    async (petId: string, patch: Partial<PetSettings>): Promise<void> => {
      const current = await getPetSettings(petId);
      const updated = { ...current, ...patch };
      await setItem(PET_SETTINGS_KEY(petId), JSON.stringify(updated));
    },
    [getPetSettings],
  );

  const totalPets = useMemo(() => pets.length, [pets]);

  const value = useMemo<PetContextValue>(
    () => ({
      pets,
      activePet,
      loading,
      error,
      setActivePet,
      refreshPets,
      getPetSettings,
      updatePetSettings,
      totalPets,
    }),
    [
      pets,
      activePet,
      loading,
      error,
      setActivePet,
      refreshPets,
      getPetSettings,
      updatePetSettings,
      totalPets,
    ],
  );

  return <PetContext.Provider value={value}>{children}</PetContext.Provider>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePetContext(): PetContextValue {
  const ctx = useContext(PetContext);
  if (!ctx) throw new Error('usePetContext must be used inside <PetProvider>');
  return ctx;
}
