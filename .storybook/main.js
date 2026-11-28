/** @type { import('@storybook/react-native').StorybookConfig } */
const config = {
  stories: ['../src/components/**/*.stories.@(ts|tsx|js|jsx|mdx)'],
  // Chromatic builds the web Storybook; keep the on-device-only addons out of it.
  features: { buildStoriesJson: true },
  addons: [
    '@storybook/addon-ondevice-controls',
    '@storybook/addon-ondevice-actions',
    '@storybook/addon-ondevice-notes',
    '@storybook/addon-ondevice-backgrounds',
  ],
};

export default config;
