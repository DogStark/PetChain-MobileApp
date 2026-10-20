import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { FeatureFlag } from '../config/constants';
import { useFeatureAvailability } from '../hooks/useFeatureAvailability';
import { useAppTheme } from '../theme';
import type { FeatureAvailabilityState } from '../services/featureAvailabilityService';

/**
 * Copy for every non-enabled state. Deliberately generic: it never names the
 * feature flag, the build setting or the rollout cohort.
 */
type BlockedState = Exclude<FeatureAvailabilityState, 'enabled'>;

const FALLBACK_COPY: Record<BlockedState, { title: string; message: string }> = {
  unavailable: {
    title: 'Not available right now',
    message: 'This feature is not available on your account yet. Your other data is unaffected.',
  },
  maintenance: {
    title: 'Under maintenance',
    message:
      'This feature is temporarily unavailable while we make improvements. Please check back shortly.',
  },
};

interface FeatureAvailabilityGateProps {
  feature: FeatureFlag;
  children: React.ReactNode;
}

/**
 * Renders children when the feature is enabled, otherwise a state-specific
 * message. Only maintenance offers a retry; unavailable is not retryable.
 */
export function FeatureAvailabilityGate({ feature, children }: FeatureAvailabilityGateProps) {
  const colors = useAppTheme();
  const { state, loading, refresh } = useFeatureAvailability(feature);

  if (state === 'enabled') {
    return <>{children}</>;
  }

  const copy = FALLBACK_COPY[state];

  return (
    <View style={styles.container} accessibilityRole="alert" accessibilityBusy={loading}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {copy.title}
      </Text>
      <Text style={[styles.message, { color: colors.secondaryText }]}>{copy.message}</Text>
      {state === 'maintenance' ? (
        <TouchableOpacity
          style={[styles.action, { backgroundColor: colors.primary }]}
          onPress={refresh}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Check again"
          accessibilityState={{ disabled: loading }}
        >
          <Text style={styles.actionLabel}>Check again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  action: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default FeatureAvailabilityGate;
