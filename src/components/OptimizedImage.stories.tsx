import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import { OptimizedImage } from './OptimizedImage';

/**
 * `OptimizedImage` — A drop-in `Image` replacement with built-in caching,
 * thumbnail-first progressive loading, and an error fallback.
 *
 * Loading strategy:
 * 1. Check in-memory cache (`cacheManager`)
 * 2. Check persistent cache (local DB)
 * 3. Show thumbnail while full image loads (when `useThumbnailFirst=true`)
 * 4. Load full-resolution image
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `uri` | `string` | — | Full-resolution image URI |
 * | `thumbnailUri` | `string` | — | Low-res thumbnail shown first |
 * | `useThumbnailFirst` | `boolean` | `true` | Show thumbnail while loading |
 * | `style` | `StyleProp<ViewStyle>` | — | Container / image style |
 *
 * All other `ImageProps` are forwarded to the underlying `<Image>`.
 *
 * ### Usage
 * ```tsx
 * <OptimizedImage
 *   uri="https://example.com/pet-full.jpg"
 *   thumbnailUri="https://example.com/pet-thumb.jpg"
 *   style={{ width: 200, height: 200, borderRadius: 8 }}
 *   resizeMode="cover"
 * />
 * ```
 */
const meta: Meta<typeof OptimizedImage> = {
  title: 'Components/OptimizedImage',
  component: OptimizedImage,
  decorators: [
    (Story) => (
      <View style={{ padding: 24, backgroundColor: '#fff', alignItems: 'center' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    uri: { control: 'text' },
    thumbnailUri: { control: 'text' },
    useThumbnailFirst: { control: 'boolean' },
  },
};

export default meta;

type Story = StoryObj<typeof OptimizedImage>;

/** Loads a remote image with progressive thumbnail-first strategy. */
export const Default: Story = {
  args: {
    uri: 'https://placekitten.com/400/400',
    thumbnailUri: 'https://placekitten.com/40/40',
    useThumbnailFirst: true,
    style: { width: 200, height: 200, borderRadius: 12 },
    resizeMode: 'cover',
  },
};

/** Square avatar size — common for pet profile photos. */
export const AvatarSize: Story = {
  args: {
    uri: 'https://placekitten.com/120/120',
    style: { width: 80, height: 80, borderRadius: 40 },
    resizeMode: 'cover',
  },
};

/** Broken URI triggers the error fallback (pink placeholder with red dot). */
export const ErrorState: Story = {
  args: {
    uri: 'https://this-url-does-not-exist.invalid/image.jpg',
    style: { width: 200, height: 200, borderRadius: 12 },
  },
};
