import React, { Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

import ErrorBoundary from './ErrorBoundary';

interface Props {
  children: React.ReactNode;
  /** Screen name forwarded to Sentry context */
  screenName?: string;
  /** Pet ID forwarded to Sentry context (optional) */
  petId?: string;
  /** User ID forwarded to Sentry context (optional) */
  userId?: string;
}

const Fallback = () => (
  <View style={styles.container}>
    <ActivityIndicator size="large" />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default function LazyScreen({ children, screenName = 'Unknown', petId, userId }: Props) {
  return (
    <ErrorBoundary context={{ screenName, petId, userId }}>
      <Suspense fallback={<Fallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
