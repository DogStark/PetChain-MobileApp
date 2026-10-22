import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import PetSelectorBar from './PetSelectorBar';

/**
 * `PetSelectorBar` — A horizontal scrollable tab bar for switching between
 * pets in a multi-pet account.
 *
 * Reads pets from `PetContext` and highlights the active pet. Optionally
 * renders an "+ Add" chip when `onAddPet` is provided.
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `onAddPet` | `() => void` | — | Callback to navigate to the add-pet flow |
 *
 * ### Usage
 * ```tsx
 * // Place at the top of any screen that needs per-pet context
 * <PetSelectorBar onAddPet={() => navigation.navigate('AddPet')} />
 * ```
 *
 * > **Note:** This component requires `PetContext`. In Storybook you must wrap
 * > it with a mock `PetProvider` or the context will be empty.
 */
const meta: Meta<typeof PetSelectorBar> = {
  title: 'Components/PetSelectorBar',
  component: PetSelectorBar,
  decorators: [
    (Story) => (
      <View style={{ backgroundColor: '#fff' }}>
        <Story />
      </View>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof PetSelectorBar>;

/** With an "Add" button — requires PetContext in a real app. */
export const WithAddButton: Story = {
  args: {
    onAddPet: action('onAddPet'),
  },
};

/** Without the "Add" button. */
export const WithoutAddButton: Story = {
  args: {},
};
