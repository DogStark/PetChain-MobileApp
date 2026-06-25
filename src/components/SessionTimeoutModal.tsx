/**
 * SessionTimeoutModal
 *
 * Displayed 2 minutes before session expiry. Shows a live countdown and offers
 * "Stay logged in" (extends the session) and "Log out now" actions.
 *
 * Wire up by subscribing to sessionMonitoringService.onTimeoutWarning() and
 * sessionMonitoringService.onTimeoutExpired() in your root component or context.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { logout } from '../services/authService';
import sessionMonitoringService from '../services/sessionMonitoringService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SessionTimeoutModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(120);
  const stayButtonRef = useRef<TouchableOpacity>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const handleStayLoggedIn = useCallback(async () => {
    dismiss();
    await sessionMonitoringService.extendSession();
  }, [dismiss]);

  const handleLogoutNow = useCallback(async () => {
    dismiss();
    await logout();
  }, [dismiss]);

  useEffect(() => {
    const unsubWarning = sessionMonitoringService.onTimeoutWarning(({ secondsRemaining: secs }) => {
      setSecondsRemaining(secs);
      if (!visible) {
        setVisible(true);
        // Announce to screen readers
        AccessibilityInfo.announceForAccessibility(
          `Your session will expire in ${formatCountdown(secs)}. Tap Stay logged in to continue.`,
        );
      }
    });

    const unsubExpired = sessionMonitoringService.onTimeoutExpired(() => {
      setVisible(false);
      logout().catch(() => {});
    });

    return () => {
      unsubWarning();
      unsubExpired();
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleStayLoggedIn}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title} accessibilityRole="header">
            Session expiring soon
          </Text>
          <Text style={styles.message}>
            Your session will expire in{' '}
            <Text style={styles.countdown} accessibilityLabel={formatCountdown(secondsRemaining)}>
              {formatCountdown(secondsRemaining)}
            </Text>{' '}
            — tap to stay logged in.
          </Text>

          <TouchableOpacity
            ref={stayButtonRef}
            style={[styles.button, styles.primaryButton]}
            onPress={handleStayLoggedIn}
            accessibilityRole="button"
            accessibilityLabel="Stay logged in"
            accessibilityHint="Extends your session and dismisses this dialog"
          >
            <Text style={styles.primaryButtonText}>Stay logged in</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleLogoutNow}
            accessibilityRole="button"
            accessibilityLabel="Log out now"
            accessibilityHint="Immediately logs you out of the app"
          >
            <Text style={styles.secondaryButtonText}>Log out now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  message: {
    fontSize: 15,
    color: '#444',
    marginBottom: 24,
    lineHeight: 22,
  },
  countdown: {
    fontWeight: '700',
    color: '#d32f2f',
  },
  button: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButton: {
    backgroundColor: '#1976d2',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#999',
  },
  secondaryButtonText: {
    color: '#444',
    fontWeight: '500',
    fontSize: 15,
  },
});

export default SessionTimeoutModal;
