import React, { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Sentry from '@sentry/react-native';

/**
 * App-scoped caches that are safe to clear from the recovery screen.
 * Keep this list limited to documented, non-sensitive, app-scoped state.
 */
export const APP_SCOPED_CACHES = ['queryCache', 'imageCache', 'preferencesCache'] as const;

export type AppScopedCache = (typeof APP_SCOPED_CACHES)[number];

export interface RecoveryScreenProps {
  /** The original error, preserved for diagnostics. Never rendered to the user. */
  error?: Error | null;
  /** Remounts the application root without duplicating providers or navigation state. */
  onRetry: () => void;
  /** Clears only documented app-scoped caches. */
  onReset: () => Promise<void> | void;
}

/**
 * Records a non-sensitive Sentry event for a startup failure.
 * Only the error name/message and platform are sent; the existing Sentry
 * privacy redaction rules strip any remaining sensitive fields.
 */
export function reportStartupFailure(error?: Error | null): void {
  try {
    Sentry.captureEvent({
      level: 'fatal',
      message: 'Native startup failure',
      tags: {
        scope: 'root-error-boundary',
        platform: Platform.OS,
      },
      extra: {
        errorName: error?.name ?? 'UnknownError',
        errorMessage: error?.message ?? 'Unknown startup error',
      },
    });
  } catch {
    // Never let diagnostics reporting crash the recovery path.
  }
}

export default function RecoveryScreen({ error, onRetry, onReset }: RecoveryScreenProps) {
  const [resetting, setResetting] = useState(false);

  const handleRetry = useCallback(() => {
    onRetry();
  }, [onRetry]);

  const performReset = useCallback(async () => {
    setResetting(true);
    try {
      await onReset();
    } finally {
      setResetting(false);
    }
  }, [onReset]);

  const handleReset = useCallback(() => {
    Alert.alert(
      'Reset app data?',
      'This clears app-scoped caches and restarts the app. Your account and saved data are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => void performReset() },
      ],
      { cancelable: true },
    );
  }, [performReset]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.brand}>Handsoff</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app could not start correctly. You can try again, or reset app-scoped caches if the
          problem keeps happening.
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Retry starting the app"
          style={[styles.button, styles.primaryButton]}
          onPress={handleRetry}
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Reset app-scoped caches"
          style={[styles.button, styles.secondaryButton]}
          onPress={handleReset}
          disabled={resetting}
        >
          <Text style={styles.secondaryButtonText}>
            {resetting ? 'Resetting…' : 'Reset app data'}
          </Text>
        </TouchableOpacity>

        {__DEV__ && error ? (
          <Text style={styles.debug} numberOfLines={3}>
            {error.name}: {error.message}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0F',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brand: {
    color: '#7C5CFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    color: '#B8B8C2',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#7C5CFF',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3A3A44',
  },
  secondaryButtonText: {
    color: '#E4E4EA',
    fontSize: 16,
    fontWeight: '600',
  },
  debug: {
    color: '#6E6E78',
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
});
