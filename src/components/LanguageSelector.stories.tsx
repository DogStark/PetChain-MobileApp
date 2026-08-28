import type { Meta, StoryObj } from '@storybook/react';
import { I18nextProvider } from 'react-i18next';
import { View } from 'react-native';

import LanguageSelector from './LanguageSelector';
import i18n from '../i18n';

const meta: Meta<typeof LanguageSelector> = {
  title: 'Components/LanguageSelector',
  component: LanguageSelector,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#ffffff', padding: 24 }}>
        <I18nextProvider i18n={i18n}>
          <Story />
        </I18nextProvider>
      </View>
    ),
  ],
  parameters: {
    notes:
      'Accessible language selection control with button hints and localized labels for screen readers.',
  },
};

export default meta;

type Story = StoryObj<typeof LanguageSelector>;

export const Default: Story = {};
