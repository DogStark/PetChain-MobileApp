import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, AppState, type AppStateStatus, I18nManager } from 'react-native';

import StorybookUIRoot from './.storybook';
import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineIndicator from './src/components/OfflineIndicator';
import { useSplashGuard } from './src/components/SplashGuard';
import ThemeTransitionView from './src/components/ThemeTransitionView';
import UpdatePrompt from './src/components/UpdatePrompt';
import {
  ConfigurationError,
  describeConfig,
  resolveProfile,
  validateConfig,
} from './src/config/envSchema';
import { PetProvider } from './src/context/PetContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { ToastProvider } from './src/context/ToastContext';
import i18n, { isRTL } from './src/i18n';
import AppNavigator, { handleNotificationDeepLink } from './src/navigation/AppNavigator';
import LockScreen from './src/screens/LockScreen';
import {
  enableScreenCapturePrevention,
  loadLockTimeout,
  getLockTimeoutMs,
  persistAppBackground,
  persistAppForeground,
  getElapsedSinceBackground,
  clearPersistedTimestamps,
} from './src/services/appLockService';
import { registerBackgroundMedicationTask } from './src/services/backgroundTaskService';
import { validateDeepLink } from './src/services/deepLinkService';
import errorTracking from './src/services/errorTracking';
import navigationQueueService from './src/services/navigationQueueService';
import {
  registerNotificationActions,
  watchNotificationActions,
} from './src/services/notificationService';
import { reconcilePendingStellarTransactions } from './src/services/stellarStartup';
import updateService from './src/services/updateService';
import { checkAppVersion } from './src/services/versionCheckService';
import { initializeWidgetService } from './src/services/widgetService';

const isStorybookEnabled = process.env.STORYBOOK_ENABLED === 'true';

// Initialise Sentry before the first render
errorTracking.init();

// Issue #1069: validate environment values at startup with typed schemas.
// Missing required values fail fast with a named ConfigurationError, and the
// redacted summary never renders or logs secret values.
const appProfile = resolveProfile(process.env.APP_ENV);
let startupConfig: ReturnType<typeof validateConfig> | null = null;
try {
  startupConfig = validateConfig(process.env as Record<string, string | undefined>, appProfile);
  // eslint-disable-next-line no-console
  console.info('[config] startup configuration', describeConfig(startupConfig));
} catch (error) {
  if (error instanceof ConfigurationError) {
    // eslint-disable-next-line no-console
    console.error(error.message);
    throw error;
  }
  throw error;
}

// Apply RTL direction based on the active language at startup.
//
// I18nManager.forceRTL only takes effect after a full app reload, so we apply
// it here — at the controlled startup boundary — and never mid-session. If the
// persisted direction no longer matches the active language (e.g. the user
// switched to Arabic/Hebrew), we flip the flag and let the next launch pick it
// up. Persisted preferences are untouched, so switching direction can never
// corrupt stored settings.
const startupRTL = isRTL(i18n.language);
I18nManager.allowRTL(true);
if (I18nManager.isRTL !== startupRTL) {
  I18nManager.forceRTL(startupRTL);
}

// Issue #1037: clinical forms must scale to the supported platform font-size
// range without clipping dosage, consent, or emergency values. React Native
// caps text scaling at `maxFontSizeMultiplier`; leaving it unbounded lets
// accessibility sizes overflow fixed-height controls. We clamp the app-wide
// default here so every clinical form inherits a safe ceiling, while still
// honouring the user's preferred size up to that ceiling.
const MAX_FONT_SIZE_MULTIPLIER = 2;
if (typeof Text !== 'undefined' && Text.defaultProps == null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Text as any).defaultProps = {};
}
if (typeof Text !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Text as any).defaultProps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...((Text as any).defaultProps ?? {}),
    maxFontSizeMultiplier: MAX_FONT_SIZE_MULTIPLIER,
    allowFontScaling: true,
  };
}

// Monotonic clock source. `performance.now()` is unaffected by wall-clock
// changes (manual clock edits, timezone/DST shifts), so background duration
// cannot be bypassed by moving the device clock backwards.
const monotonicNow = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

function App() {
  const { appReady } = useSplashGuard();
  const [updateStatus, setUpdateStatus] = React.useState<
    { visible: false } | { visible: true; variant: 'optional' | 'force'; storeUrl?: string }
  >({ visible: false });
  const [locked, setLocked] = useState(false);
  const [pinFallback, setPinFallback] = useState(false);

  // Enable screen capture prevention on mount
  useEffect(() => {
    void enableScreenCapturePrevention();
  }, []);

  // Lock app after idle timeout when returning to foreground.
  // Background duration is measured with a monotonic clock so wall-clock
  // changes cannot bypass the lock, and the persisted timestamps are used as
  // a fallback when the process was killed and the in-memory clock is lost.
  useEffect(() => {
    let backgroundedAt: number | null = null;

    const onChange = async (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt = monotonicNow();
        await persistAppBackground();
      } else if (state === 'active') {
        await persistAppForeground();
        const timeout = await loadLockTimeout();
        const ms = getLockTimeoutMs(timeout);
        if (ms <= 0) {
          backgroundedAt = null;
          return;
        }

        // Prefer monotonic elapsed time for the current process; fall back to
        // the persisted (wall-clock) elapsed time when the process was killed.
        const monotonicElapsed =
          backgroundedAt !== null ? monotonicNow() - backgroundedAt : null;
        const persistedElapsed = await getElapsedSinceBackground();
        const elapsed =
          monotonicElapsed !== null
            ? Math.max(monotonicElapsed, persistedElapsed)
            : persistedElapsed;

        backgroundedAt = null;

        if (elapsed >= ms) {
          setPinFallback(false);
          setLocked(true);
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  // Check for updates on launch
  React.useEffect(() => {
    if (!appReady) return;
    void (async () => {
      // 1. Check server-side minimum version (critical/recommended)
      const versionResult = await checkAppVersion();
      if (versionResult.type === 'critical') {
        setUpdateStatus({ visible: true, variant: 'force', storeUrl: versionResult.storeUrl });
        return; // no need to check OTA if a store update is required
      }
      if (versionResult.type === 'recommended') {
        setUpdateStatus({ visible: true, variant: 'optional', storeUrl: versionResult.storeUrl });
        return;
      }

      // 2. Fall back to OTA check via expo-updates
      const result = await updateService.checkForUpdate();
      if (result.type === 'force-update') {
        setUpdateStatus({ visible: true, variant: 'force', storeUrl: result.storeUrl });
      } else if (result.type === 'ota-available') {
        setUpdateStatus({ visible: true, variant: 'optional' });
      }
    })();
  }, [appReady]);

  const handleUpdate = () => {
    void updateService.applyOtaUpdate();
  };

  const handleDismiss = () => {
    setUpdateStatus({ visible: false });
  };

  useEffect(() => {
    void registerNotificationActions();
    const subscription = watchNotificationActions();
    void registerBackgroundMedicationTask();

    // Issue #947: the app can be terminated between submitting a Stellar
    // transaction and learning its outcome. Resolve anything left in flight
    // against Horizon on launch, so a payment is never silently lost — and,
    // just as importantly, never re-sent because its status was unknown.
    void reconcilePendingStellarTransactions();

    // Initialize widget service and update widgets
    const unsubscribeWidget = initializeWidgetService();

    return () => {
      subscription.remove();
      unsubscribeWidget();
    };
  }, []);

  // Handle initial notification if app was launched from a notification
  useEffect(() => {
    void (async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (response) {
        const url = response.notification.request.content.data?.url;
        if (typeof url === 'string' && validateDeepLink(url)) {
          handleNotificationDeepLink(url);
        }
      }
    })();
  }, []);

  // Drain any deep links queued while the navigator was not ready.
  useEffect(() => {
    if (!appReady) return;
    void navigationQueueService.flush();
  }, [appReady]);

  // Clear persisted lock timestamps when the app is intentionally unlocked.
  useEffect(() => {
    if (!locked) {
      void clearPersistedTimestamps();
    }
  }, [locked]);

  if (isStorybookEnabled) {
    return <StorybookUIRoot />;
  }

  if (locked) {
    return (
      <LockScreen
        onUnlock={() => {
          setPinFallback(false);
          setLocked(false);
        }}
        onFallback={() => setPinFallback(true)}
        pinFallback={pinFallback}
      />
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <PetProvider>
            <ThemeTransitionView style={styles.container}>
              <AppNavigator />
              <OfflineIndicator />
              <UpdatePrompt
                visible={updateStatus.visible}
                variant={updateStatus.visible ? updateStatus.variant : 'optional'}
                storeUrl={updateStatus.visible ? updateStatus.storeUrl : undefined}
                onUpdate={handleUpdate}
                onDismiss={handleDismiss}
              />
            </ThemeTransitionView>
          </PetProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
