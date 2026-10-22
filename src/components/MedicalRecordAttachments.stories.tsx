import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import MedicalRecordAttachments from './MedicalRecordAttachments';
import type { MedicalDocumentMetadata } from '../models/MedicalRecord';

const attachments: MedicalDocumentMetadata[] = [
  {
    id: 'attachment-1',
    name: 'Rabies Vaccination Record',
    mimeType: 'application/pdf',
    type: 'pdf',
    url: 'https://example.com/sample.pdf',
    sizeBytes: 164832,
  },
  {
    id: 'attachment-2',
    name: 'X-ray scan',
    mimeType: 'image/jpeg',
    type: 'image',
    url: 'https://via.placeholder.com/320x240.png?text=X-ray',
    sizeBytes: 324567,
  },
];

const meta: Meta<typeof MedicalRecordAttachments> = {
  title: 'Components/MedicalRecordAttachments',
  component: MedicalRecordAttachments,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#ffffff', padding: 24 }}>
        <Story />
      </View>
    ),
  ],
  parameters: {
    notes:
      'Displays medical document attachments with accessible preview cards, labels, and tap hints.',
  },
};

export default meta;

type Story = StoryObj<typeof MedicalRecordAttachments>;

export const Default: Story = {
  args: {
    documents: attachments,
  },
};
