import type { Meta, StoryObj } from '@storybook/react';
import { Text, View } from 'react-native';

import { ErrorBoundary } from './ErrorBoundary';

/**
 * `ErrorBoundary` — A React class component that catches unhandled errors in
 * its child tree and renders a fallback UI with Retry and Report actions.
 *
 * - Logs errors via `errorLogger`
 * - Supports retry by remounting children via an internal `resetKey`
 * - Accessible buttons for retry and error reporting
 *
 * ### Usage
 * ```tsx
 * <ErrorBoundary>
 *   <MyScreen />
 * </ErrorBoundary>
 * ```
 */
const meta: Meta<typeof ErrorBoundary> = {
  title: 'Components/ErrorBoundary',
  component: ErrorBoundary,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <Story />
      </View>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ErrorBoundary>;

/** Renders children normally when no error has occurred. */
export const WithChildren: Story = {
  render: () => (
    <ErrorBoundary>
      <View style={{ padding: 24 }}>
        <Text style={{ fontSize: 16, color: '#333' }}>✅ No error — children render normally.</Text>
      </View>
    </ErrorBoundary>
  ),
};

/**
 * Simulates the error fallback UI by rendering a component that throws.
 * In Storybook the boundary catches the throw and shows Retry / Report.
 */
const ThrowingComponent = () => {
  throw new Error('Simulated render error for Storybook');
};

export const ErrorFallback: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowingComponent />
    </ErrorBoundary>
  ),
};
