import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const COUNTDOWN_SECONDS = 5;

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
 */
export default function SOSScreen(): React.ReactElement {
  const [countdown, setCountdown] = useState<number | null>(null);
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
      AccessibilityInfo.announceForAccessibility('SOS activated');
      return;
    }
    timerRef.current = setInterval(() => {
      setCountdown((current) => (current === null ? null : current - 1));
    }, 1000);
    return clearTimer;
  }, [countdown, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const isCountingDown = countdown !== null;

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
