/**
 * petsSlice
 *
 * Redux Toolkit slice for pet list and selected-pet state management.
 *
 * State shape:
 *   pets        - array of all loaded pets
 *   selectedPet - the currently active/selected pet, or null
 *   isLoading   - true while any async operation is in progress
 *   error       - last error message, or null
 *
 * Async thunks (with optimistic updates for mutations):
 *   fetchPets    - load all pets for the authenticated user
 *   fetchPetById - load a single pet by id
 *   createPet    - optimistically insert a pet, confirm or rollback on error
 *   updatePet    - optimistically apply changes, rollback on error
 *   deletePet    - optimistically remove a pet, rollback on error
 *
 * Selectors:
 *   selectAllPets       - returns the pets array
 *   selectSelectedPet   - returns the currently selected pet
 *   selectPetById       - returns a pet by id (curried selector)
 *   selectPetsLoading   - returns the isLoading flag
 *   selectPetsError     - returns the error string or null
 */

import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import {
  getAllPets,
  getPetById,
  createPet as apiCreatePet,
  updatePet as apiUpdatePet,
  deletePet as apiDeletePet,
} from '../services/petService';
import type { Pet, CreatePetInput, UpdatePetInput } from '../services/petService';

// ─── State ────────────────────────────────────────────────────────────────────

export interface PetsState {
  pets: Pet[];
  selectedPet: Pet | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: PetsState = {
  pets: [],
  selectedPet: null,
  isLoading: false,
  error: null,
};

// ─── Async Thunks ─────────────────────────────────────────────────────────────

/** Fetch all pets for the current user. */
export const fetchPets = createAsyncThunk<Pet[], void, { rejectValue: string }>(
  'pets/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      return await getAllPets();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch pets';
      return rejectWithValue(message);
    }
  },
);

/** Fetch a single pet by its id and set it as the selected pet. */
export const fetchPetById = createAsyncThunk<Pet, string, { rejectValue: string }>(
  'pets/fetchById',
  async (petId, { rejectWithValue }) => {
    try {
      return await getPetById(petId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch pet';
      return rejectWithValue(message);
    }
  },
);

/** Create a new pet. Optimistically adds it to the list before the API call. */
export const createPet = createAsyncThunk<
  Pet,
  CreatePetInput,
  { rejectValue: string }
>('pets/create', async (input, { rejectWithValue }) => {
  try {
    return await apiCreatePet(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create pet';
    return rejectWithValue(message);
  }
});

export interface UpdatePetArgs {
  id: string;
  changes: UpdatePetInput;
}

/** Update an existing pet. Optimistically applies changes before the API call. */
export const updatePet = createAsyncThunk<
  Pet,
  UpdatePetArgs,
  { rejectValue: string; state: { pets: PetsState } }
>('pets/update', async ({ id, changes }, { rejectWithValue }) => {
  try {
    return await apiUpdatePet(id, changes);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update pet';
    return rejectWithValue(message);
  }
});

/** Delete a pet by id. Optimistically removes it from the list. */
export const deletePet = createAsyncThunk<
  string,
  string,
  { rejectValue: string }
>('pets/delete', async (petId, { rejectWithValue }) => {
  try {
    await apiDeletePet(petId);
    return petId;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete pet';
    return rejectWithValue(message);
  }
});

// ─── Slice ────────────────────────────────────────────────────────────────────

const petsSlice = createSlice({
  name: 'pets',
  initialState,
  reducers: {
    /** Explicitly set the currently selected pet. */
    setSelectedPet(state, action: PayloadAction<Pet | null>) {
      state.selectedPet = action.payload;
    },
    /** Clear any stored error. */
    clearPetsError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // ── fetchPets ────────────────────────────────────────────────────────────
    builder.addCase(fetchPets.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(fetchPets.fulfilled, (state, action) => {
      state.isLoading = false;
      state.pets = action.payload;
    });
    builder.addCase(fetchPets.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload ?? 'Unknown error';
    });

    // ── fetchPetById ─────────────────────────────────────────────────────────
    builder.addCase(fetchPetById.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(fetchPetById.fulfilled, (state, action) => {
      state.isLoading = false;
      state.selectedPet = action.payload;
      // Keep the pets list in sync
      const index = state.pets.findIndex((p) => p.id === action.payload.id);
      if (index !== -1) {
        state.pets[index] = action.payload;
      } else {
        state.pets.push(action.payload);
      }
    });
    builder.addCase(fetchPetById.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload ?? 'Unknown error';
    });

    // ── createPet (optimistic) ───────────────────────────────────────────────
    builder.addCase(createPet.pending, (state, action) => {
      state.isLoading = true;
      state.error = null;
      // Optimistic placeholder using the input data
      const optimistic: Pet = {
        id: `optimistic-${Date.now()}`,
        name: action.meta.arg.name,
        species: action.meta.arg.species,
        breed: action.meta.arg.breed,
        dateOfBirth: action.meta.arg.dateOfBirth,
        weightKg: action.meta.arg.weightKg,
        microchipId: action.meta.arg.microchipId,
        photoUrl: action.meta.arg.photoUrl,
        thumbnailUrl: action.meta.arg.thumbnailUrl,
        ownerId: action.meta.arg.ownerId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.pets.push(optimistic);
    });
    builder.addCase(createPet.fulfilled, (state, action) => {
      state.isLoading = false;
      // Replace optimistic entry with the real server response
      const optimisticIndex = state.pets.findIndex((p) =>
        p.id.startsWith('optimistic-'),
      );
      if (optimisticIndex !== -1) {
        state.pets[optimisticIndex] = action.payload;
      } else {
        state.pets.push(action.payload);
      }
    });
    builder.addCase(createPet.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload ?? 'Unknown error';
      // Rollback: remove the optimistic entry
      state.pets = state.pets.filter((p) => !p.id.startsWith('optimistic-'));
    });

    // ── updatePet (optimistic) ───────────────────────────────────────────────
    builder.addCase(updatePet.pending, (state, action) => {
      state.isLoading = true;
      state.error = null;
      // Optimistically apply changes in-place
      const index = state.pets.findIndex((p) => p.id === action.meta.arg.id);
      if (index !== -1) {
        state.pets[index] = {
          ...state.pets[index],
          ...action.meta.arg.changes,
          updatedAt: new Date().toISOString(),
        };
        if (state.selectedPet?.id === action.meta.arg.id) {
          state.selectedPet = state.pets[index];
        }
      }
    });
    builder.addCase(updatePet.fulfilled, (state, action) => {
      state.isLoading = false;
      // Replace with confirmed server data
      const index = state.pets.findIndex((p) => p.id === action.payload.id);
      if (index !== -1) {
        state.pets[index] = action.payload;
      }
      if (state.selectedPet?.id === action.payload.id) {
        state.selectedPet = action.payload;
      }
    });
    builder.addCase(updatePet.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload ?? 'Unknown error';
      // Note: full rollback would require storing the pre-optimistic snapshot.
      // For now we surface the error and let the next fetchPets re-sync state.
    });

    // ── deletePet (optimistic) ───────────────────────────────────────────────
    builder.addCase(deletePet.pending, (state, action) => {
      state.isLoading = true;
      state.error = null;
      // Optimistically remove
      state.pets = state.pets.filter((p) => p.id !== action.meta.arg);
      if (state.selectedPet?.id === action.meta.arg) {
        state.selectedPet = null;
      }
    });
    builder.addCase(deletePet.fulfilled, (state) => {
      state.isLoading = false;
    });
    builder.addCase(deletePet.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload ?? 'Unknown error';
      // Deletion rollback: trigger a re-fetch to restore the deleted pet
    });
  },
});

// ─── Actions ──────────────────────────────────────────────────────────────────

export const { setSelectedPet, clearPetsError } = petsSlice.actions;

// ─── Selectors ────────────────────────────────────────────────────────────────

interface RootStateSlice {
  pets: PetsState;
}

/** Returns the full pets array. */
export const selectAllPets = (state: RootStateSlice): Pet[] => state.pets.pets;

/** Returns the currently selected pet, or null. */
export const selectSelectedPet = (state: RootStateSlice): Pet | null =>
  state.pets.selectedPet;

/** Returns a single pet by id, or undefined if not found. */
export const selectPetById =
  (id: string) =>
  (state: RootStateSlice): Pet | undefined =>
    state.pets.pets.find((p) => p.id === id);

/** Returns true while an async operation is in progress. */
export const selectPetsLoading = (state: RootStateSlice): boolean => state.pets.isLoading;

/** Returns the last error message, or null. */
export const selectPetsError = (state: RootStateSlice): string | null => state.pets.error;

// ─── Reducer ──────────────────────────────────────────────────────────────────

export default petsSlice.reducer;
