import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import QRCodeDisplay from './QRCodeDisplay';
import { createPet } from '../models/Pet';

const samplePet = createPet({
  id: 'storybook-pet-001',
  name: 'Buddy',
  species: 'dog',
  breed: 'Golden Retriever',
  microchipId: 'A1B2C3D4E5F6G7H',
  ownerId: 'owner-123',
});

const meta: Meta<typeof QRCodeDisplay> = {
  title: 'Components/QRCodeDisplay',
  component: QRCodeDisplay,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#ffffff', padding: 24 }}>
        <Story />
      </View>
    ),
  ],
  parameters: {
    notes: 'Renders a PetChain QR code image with accessible alt text for the current pet.',
  },
};

export default meta;

type Story = StoryObj<typeof QRCodeDisplay>;

export const Default: Story = {
  args: {
    pet: samplePet,
    size: 240,
  },
};
