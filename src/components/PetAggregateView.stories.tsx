import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { View } from 'react-native';

import PetAggregateView from './PetAggregateView';
import { PetContext } from '../context/PetContext';
import type { Pet } from '../services/petService';

/**
 * `PetAggregateView` — A summary card grid showing all pets in an account
 * with quick-access stats and a pet selector.
 *
 * Each pet card displays:
 * - Species emoji
 * - Name
 * - Species & breed
 * - Active indicator dot (green) for the currently selected pet
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `onSelectPet` | `(pet: Pet) => void` | — | Callback when a pet card is tapped |
 *
 * ### Usage
 * ```tsx
 * <PetAggregateView onSelectPet={(pet) => setActivePet(pet)} />
 * ```
 *
 * > **Note:** Requires `PetContext`. Wrap with a mock `PetProvider` in Storybook.
 */
const meta: Meta<typeof PetAggregateView> = {
  title: 'Components/PetAggregateView',
  component: PetAggregateView,
  decorators: [
    (Story) => (
      <View style={{ padding: 16, backgroundColor: '#f5f5f5' }}>
        <Story />
      </View>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof PetAggregateView>;

// Mock Pets
const petBella: Pet = {
  id: 'pet-1',
  name: 'Bella',
  species: 'dog',
  breed: 'Golden Retriever',
  dateOfBirth: '2020-05-15',
  weightKg: 28.5,
  microchipId: '985112000123456',
  photoUrl:
    'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&q=80&w=200',
  thumbnailUrl:
    'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&q=80&w=100',
  ownerId: 'owner-1',
  createdAt: '2023-01-10T10:00:00Z',
  updatedAt: '2023-01-10T10:00:00Z',
};

const petOliver: Pet = {
  id: 'pet-2',
  name: 'Oliver',
  species: 'cat',
  breed: 'Siamese',
  dateOfBirth: '2021-08-20',
  weightKg: 4.2,
  photoUrl:
    'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&q=80&w=200',
  thumbnailUrl:
    'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&q=80&w=100',
  ownerId: 'owner-1',
  createdAt: '2023-02-15T11:00:00Z',
  updatedAt: '2023-02-15T11:00:00Z',
};

const petBluey: Pet = {
  id: 'pet-3',
  name: 'Bluey',
  species: 'bird',
  breed: 'Budgerigar',
  dateOfBirth: '2022-11-01',
  ownerId: 'owner-1',
  createdAt: '2023-03-05T09:00:00Z',
  updatedAt: '2023-03-05T09:00:00Z',
};

const petBunny: Pet = {
  id: 'pet-4',
  name: 'Bunny',
  species: 'rabbit',
  breed: 'Angora',
  dateOfBirth: '2022-01-12',
  ownerId: 'owner-1',
  createdAt: '2023-04-01T12:00:00Z',
  updatedAt: '2023-04-01T12:00:00Z',
};

const petCoco: Pet = {
  id: 'pet-5',
  name: 'Coco',
  species: 'dog',
  breed: 'French Bulldog',
  dateOfBirth: '2019-06-18',
  ownerId: 'owner-1',
  createdAt: '2023-05-15T14:30:00Z',
  updatedAt: '2023-05-15T14:30:00Z',
};

const petLuna: Pet = {
  id: 'pet-6',
  name: 'Luna',
  species: 'cat',
  breed: 'Persian',
  dateOfBirth: '2020-10-10',
  ownerId: 'owner-1',
  createdAt: '2023-06-20T08:15:00Z',
  updatedAt: '2023-06-20T08:15:00Z',
};

const petCleo: Pet = {
  id: 'pet-7',
  name: 'Cleo',
  species: 'bird',
  ownerId: 'owner-1',
  createdAt: '2023-07-01T10:00:00Z',
  updatedAt: '2023-07-01T10:00:00Z',
};

const petDaisy: Pet = {
  id: 'pet-8',
  name: 'Daisy',
  species: 'rabbit',
  ownerId: 'owner-1',
  createdAt: '2023-08-01T11:00:00Z',
  updatedAt: '2023-08-01T11:00:00Z',
};

// Helper to create mock context provider value
const createMockContext = (
  pets: Pet[],
  activePet: Pet | null = null,
  loading = false,
  error: Error | null = null,
) => ({
  pets,
  activePet: activePet || pets[0] || null,
  loading,
  error,
  setActivePet: action('setActivePet'),
  refreshPets: async () => action('refreshPets')(),
  getPetSettings: async (id: string) => {
    action('getPetSettings')(id);
    return {
      notificationsEnabled: true,
      reminderLeadMinutes: 60,
      weightUnit: 'kg' as const,
      notes: '',
    };
  },
  updatePetSettings: async (
    id: string,
    patch: Partial<import('../context/PetContext').PetSettings>,
  ) => {
    action('updatePetSettings')(id, patch);
  },
  totalPets: pets.length,
});

/** Single pet display (Free or basic account structure) */
export const SinglePet: Story = {
  render: (args) => (
    <PetContext.Provider value={createMockContext([petBella])}>
      <PetAggregateView {...args} />
    </PetContext.Provider>
  ),
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Account with multiple pets registered */
export const MultiplePets: Story = {
  render: (args) => (
    <PetContext.Provider value={createMockContext([petBella, petOliver, petBluey, petBunny])}>
      <PetAggregateView {...args} />
    </PetContext.Provider>
  ),
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Premium Plan with maximum capacity of pets (e.g. 8 pets) */
export const PremiumPlanMaxPets: Story = {
  render: (args) => (
    <PetContext.Provider
      value={createMockContext([
        petBella,
        petOliver,
        petBluey,
        petBunny,
        petCoco,
        petLuna,
        petCleo,
        petDaisy,
      ])}
    >
      <PetAggregateView {...args} />
    </PetContext.Provider>
  ),
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Free Plan that has hit the pet limit of 1 */
export const FreePlanLimitReached: Story = {
  render: (args) => (
    <PetContext.Provider value={createMockContext([petBella])}>
      <PetAggregateView {...args} />
    </PetContext.Provider>
  ),
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Pet with active health warnings or alerts */
export const PetWithActiveHealthAlert: Story = {
  render: (args) => {
    const petWithAlert = { ...petBella, name: 'Bella (Alert)' };
    return (
      <PetContext.Provider value={createMockContext([petWithAlert, petOliver])}>
        <PetAggregateView {...args} />
      </PetContext.Provider>
    );
  },
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Pet registration without a photo (displays default fallback icon) */
export const PetWithNoPhoto: Story = {
  render: (args) => {
    const petNoPhoto = { ...petOliver, photoUrl: undefined, thumbnailUrl: undefined };
    return (
      <PetContext.Provider value={createMockContext([petBella, petNoPhoto])}>
        <PetAggregateView {...args} />
      </PetContext.Provider>
    );
  },
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Initial loading/fetching state */
export const LoadingState: Story = {
  render: (args) => (
    <PetContext.Provider value={createMockContext([], null, true)}>
      <PetAggregateView {...args} />
    </PetContext.Provider>
  ),
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Empty list state when no pets are registered yet */
export const EmptyState: Story = {
  render: (args) => (
    <PetContext.Provider value={createMockContext([], null, false)}>
      <PetAggregateView {...args} />
    </PetContext.Provider>
  ),
  args: {
    onSelectPet: action('onSelectPet'),
  },
};

/** Error loading pets state */
export const ErrorState: Story = {
  render: (args) => (
    <PetContext.Provider
      value={createMockContext([], null, false, new Error('Failed to load pets'))}
    >
      <PetAggregateView {...args} />
    </PetContext.Provider>
  ),
  args: {
    onSelectPet: action('onSelectPet'),
  },
};
