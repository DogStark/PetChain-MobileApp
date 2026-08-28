import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import { PetPhotoUploader } from './PetPhotoUploader';

/**
 * `PetPhotoUploader` — A tappable photo widget that opens the device image
 * picker, uploads the selected photo via `petService.uploadPetPhoto`, and
 * displays the result using `OptimizedImage`.
 *
 * Shows a placeholder "Add Photo" label when no photo exists, and the current
 * photo (with thumbnail-first loading) once one is set.
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `petId` | `string` | — | ID of the pet to attach the photo to |
 * | `currentPhotoUrl` | `string` | — | Existing full-res photo URL |
 * | `currentThumbnailUrl` | `string` | — | Existing thumbnail URL |
 * | `onPhotoUploaded` | `(url: string) => void` | — | Callback with the new photo URL |
 *
 * ### Usage
 * ```tsx
 * <PetPhotoUploader
 *   petId={pet.id}
 *   currentPhotoUrl={pet.photoUrl}
 *   onPhotoUploaded={(url) => updatePet({ photoUrl: url })}
 * />
 * ```
 */
const meta: Meta<typeof PetPhotoUploader> = {
  title: 'Components/PetPhotoUploader',
  component: PetPhotoUploader,
  decorators: [
    (Story) => (
      <View style={{ padding: 24, backgroundColor: '#fff', alignItems: 'center' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    petId: { control: 'text' },
    currentPhotoUrl: { control: 'text' },
    currentThumbnailUrl: { control: 'text' },
  },
};

export default meta;

type Story = StoryObj<typeof PetPhotoUploader>;

/** No existing photo — shows "Add Photo" placeholder. */
export const Empty: Story = {
  args: {
    petId: 'pet-001',
    onPhotoUploaded: action('onPhotoUploaded'),
  },
};

/** Existing photo loaded via `OptimizedImage`. */
export const WithPhoto: Story = {
  args: {
    petId: 'pet-001',
    currentPhotoUrl: 'https://placekitten.com/400/400',
    currentThumbnailUrl: 'https://placekitten.com/40/40',
    onPhotoUploaded: action('onPhotoUploaded'),
  },
};
