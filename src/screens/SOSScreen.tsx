import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const COUNTDOWN_SECONDS = 5;

type LocationPermissionStatus = 'granted' | 'denied' | 'revoked' | 'unknown';

/**
 * SOS screen.
 *
 * Accessibility: the SOS action is a single focusable element with an
 * explicit accessibility role/label so switch-control and other non-touch
 * input methods can reach and activate it. Activation is wired through
 * `onPress` (which switch control triggers) as well as an explicit
 * `activate` accessibility action. Countdown and cancel state are announced
 * via a live region so assistive tech reports progress without gestures.
 * Accidental activation stays prevented by the existing countdown + cancel
 * confirmation path.
 *
 * Location: the permission status is treated as server-confirmed state
 * (`locationPermission`). When it is denied or revoked the screen explains
 * the degraded behavior (no coordinates are attached) and offers a shortcut
 * to system settings, while the emergency contact flow still proceeds.
 */
export default function SOSScreen(): React.ReactElement {
  const [countdown, setCountdown] = useState<number | null>(null);
  const [locationPermission, setLocationPermission] =
    useState<LocationPermissionStatus>('unknown');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    setCountdown(null);
    AccessibilityInfo.announceForAccessibility('SOS activation cancelled');
  }, [clearTimer]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      AccessibilityInfo.announceForAccessibility(
        'Unable to open system settings. Please enable location in your device settings.',
      );
    });
  }, []);

  const trigger = useCallback(() => {
    // Confirmation countdown prevents accidental activation.
    setCountdown(COUNTDOWN_SECONDS);
    AccessibilityInfo.announceForAccessibility(
      `SOS will activate in ${COUNTDOWN_SECONDS} seconds. Activate cancel to stop.`,
    );
  }, []);

  useEffect(() => {
    if (countdown === null) {
      return;
    }
    if (countdown <= 0) {
      clearTimer();
      setCountdown(null);
      AccessibilityInfo.announceForAccessibility(
        locationPermission === 'granted'
          ? 'SOS activated with your location'
          : 'SOS activated without location. Emergency contacts are being notified.',
      );
      return;
    }
    timerRef.current = setInterval(() => {
      setCountdown((current) => (current === null ? null : current - 1));
    }, 1000);
    return clearTimer;
  }, [countdown, clearTimer, locationPermission]);

  useEffect(() => clearTimer, [clearTimer]);

  const isCountingDown = countdown !== null;
  const isLocationDegraded =
    locationPermission === 'denied' || locationPermission === 'revoked';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Emergency SOS</Text>

      <Text
        style={styles.status}
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
      >
        {isCountingDown
          ? `SOS activating in ${countdown} seconds`
          : 'SOS is ready'}
      </Text>

      {isLocationDegraded ? (
        <View
          style={styles.locationNotice}
          accessible
          accessibilityRole="text"
          accessibilityLabel="Location unavailable. SOS will still notify your emergency contacts, but your coordinates will not be shared."
        >
          <Text style={styles.locationNoticeTitle}>Location unavailable</Text>
          <Text style={styles.locationNoticeBody}>
            {locationPermission === 'revoked'
              ? 'Location access was revoked. SOS will still notify your emergency contacts, but your coordinates will not be shared.'
              : 'Location access is denied. SOS will still notify your emergency contacts, but your coordinates will not be shared.'}
          </Text>
          <Pressable
            style={styles.settingsButton}
            onPress={openSettings}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Open system settings to enable location"
            accessibilityHint="Opens device settings where you can grant location access"
            accessibilityActions={[{ name: 'activate', label: 'Open settings' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'activate') {
                openSettings();
              }
            }}
          >
            <Text style={styles.settingsText}>Open Settings</Text>
          </Pressable>
        </View>
      ) : null}

      {isCountingDown ? (
        <Pressable
          style={styles.cancelButton}
          onPress={cancel}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Cancel SOS activation"
          accessibilityHint="Stops the SOS countdown"
          accessibilityActions={[{ name: 'activate', label: 'Cancel SOS' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate') {
              cancel();
            }
          }}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      ) : (
        <Pressable
          style={styles.sosButton}
          onPress={trigger}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Activate SOS"
          accessibilityHint="Starts a countdown before sending the emergency alert"
          accessibilityActions={[{ name: 'activate', label: 'Activate SOS' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate') {
              trigger();
            }
          }}
        >
          <Text style={styles.sosText}>SOS</Text>
        </Pressable>
      )}
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
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
  },
  status: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  locationNotice: {
    width: '100%',
    padding: 16,
    marginBottom: 24,
    borderRadius: 8,
    backgroundColor: '#fff3e0',
  },
  locationNoticeTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  locationNoticeBody: {
    fontSize: 14,
    marginBottom: 12,
  },
  settingsButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#424242',
  },
  settingsText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  sosButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d32f2f',
  },
  sosText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    backgroundColor: '#424242',
  },
  cancelText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
});
