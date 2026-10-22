import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useMedicationSchedules } from '../hooks/useMedicationSchedules';
import { useDoseLogs } from '../hooks/useDoseLogs';
import { MedicationSchedule, DoseLog } from '../types/medication';
import { formatTime } from '../utils/date';

// A jump larger than this (in ms) between the device clock and the trusted
// server/ledger clock is treated as tampering rather than normal drift.
const CLOCK_DRIFT_TOLERANCE_MS = 5 * 60 * 1000;

// A dose is only considered "due" if its scheduled time is not in the future
// relative to the trusted clock. Anything beyond this grace window is refused.
const FUTURE_DOSE_GRACE_MS = 60 * 1000;

type ClockTrust = 'trusted' | 'untrusted';

interface ClockState {
  trust: ClockTrust;
  driftMs: number;
  reason?: 'forward-jump' | 'backward-jump' | 'timezone-change' | 'dst-transition' | 'offline';
}

/**
 * Compare the device clock against the authoritative server/ledger time.
 * Returns the drift in ms (device - server). Positive means the device is ahead.
 */
function computeDrift(deviceNow: number, serverNow?: number | null): number | null {
  if (serverNow == null || Number.isNaN(serverNow)) {
    return null;
  }
  return deviceNow - serverNow;
}

function classifyDrift(driftMs: number): ClockState {
  if (Math.abs(driftMs) <= CLOCK_DRIFT_TOLERANCE_MS) {
    return { trust: 'trusted', driftMs };
  }
  return {
    trust: 'untrusted',
    driftMs,
    reason: driftMs > 0 ? 'forward-jump' : 'backward-jump',
  };
}

interface Props {
  serverTimeProvider?: () => Promise<number | null>;
}

export const MedicationScheduleScreen: React.FC<Props> = ({ serverTimeProvider }) => {
  const { schedules, loading: schedulesLoading, refresh: refreshSchedules } = useMedicationSchedules();
  const { logDose, hasLoggedDose } = useDoseLogs();

  const [clock, setClock] = useState<ClockState>({ trust: 'trusted', driftMs: 0 });
  const [warningDismissed, setWarningDismissed] = useState(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const reconcileClock = useCallback(async () => {
    const deviceNow = Date.now();
    let serverNow: number | null = null;
    try {
      serverNow = serverTimeProvider ? await serverTimeProvider() : null;
    } catch {
      serverNow = null;
    }

    const drift = computeDrift(deviceNow, serverNow);
    if (drift == null) {
      // Offline: keep schedules viewable, but mark time as untrusted so we
      // never silently record a dose against an unverified clock.
      setClock({ trust: 'untrusted', driftMs: 0, reason: 'offline' });
      return;
    }

    setClock(classifyDrift(drift));
  }, [serverTimeProvider]);

  // Detect clock changes on app resume.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/);
      appState.current = next;
      if (wasBackground && next === 'active') {
        void reconcileClock();
      }
    });
    return () => subscription.remove();
  }, [reconcileClock]);

  useEffect(() => {
    void reconcileClock();
  }, [reconcileClock]);

  const isTimeTrusted = clock.trust === 'trusted';

  const handleLogDose = useCallback(
    async (schedule: MedicationSchedule) => {
      // Re-verify the clock during the dose-log flow before writing anything.
      await reconcileClock();

      const deviceNow = Date.now();
      const scheduledAt = new Date(schedule.scheduledTime).getTime();

      if (deviceNow + FUTURE_DOSE_GRACE_MS < scheduledAt) {
        Alert.alert(
          'Dose not due yet',
          'Your device clock appears to be ahead of the trusted time. This dose cannot be logged until it is actually due.',
        );
        return;
      }

      if (hasLoggedDose(schedule.id)) {
        Alert.alert('Already logged', 'This dose has already been recorded for the current schedule window.');
        return;
      }

      if (!isTimeTrusted) {
        Alert.alert(
          'Time not verified',
          'We could not verify your device clock. The dose will be recorded using the server timestamp once you are back online.',
        );
      }

      await logDose(schedule.id, { recordedAt: deviceNow, trust: clock.trust });
    },
    [clock.trust, hasLoggedDose, isTimeTrusted, logDose, reconcileClock],
  );

  const warningMessage = useMemo(() => {
    if (isTimeTrusted || warningDismissed) {
      return null;
    }
    switch (clock.reason) {
      case 'forward-jump':
        return 'Your device clock jumped forward. Reminders and dose logging are paused until time is verified.';
      case 'backward-jump':
        return 'Your device clock jumped backward. Reminders and dose logging are paused until time is verified.';
      case 'timezone-change':
        return 'Your timezone changed. Please confirm your schedule times before logging doses.';
      case 'dst-transition':
        return 'A daylight-saving transition was detected. Please confirm your schedule times.';
      case 'offline':
      default:
        return 'You are offline. You can still view your schedules, but dose logging will use the server timestamp once reconnected.';
    }
  }, [clock.reason, isTimeTrusted, warningDismissed]);

  const renderSchedule = ({ item }: { item: MedicationSchedule }) => (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.time}>{formatTime(item.scheduledTime)}</Text>
      </View>
      <TouchableOpacity
        style={[styles.logButton, !isTimeTrusted && styles.logButtonDisabled]}
        onPress={() => void handleLogDose(item)}
        accessibilityRole="button"
        accessibilityLabel={`Log dose for ${item.name}`}
      >
        <Text style={styles.logButtonText}>Log dose</Text>
      </TouchableOpacity>
    </View>
  );

  if (schedulesLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {warningMessage ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>{warningMessage}</Text>
          <TouchableOpacity onPress={() => setWarningDismissed(true)} accessibilityRole="button">
            <Text style={styles.warningDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={schedules}
        keyExtractor={(item) => item.id}
        renderItem={renderSchedule}
        onRefresh={() => void refreshSchedules()}
        refreshing={schedulesLoading}
        ListEmptyComponent={<Text style={styles.empty}>No medication schedules yet.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  warning: {
    backgroundColor: '#FFF4E5',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  warningText: { flex: 1, color: '#8A5300', fontSize: 13 },
  warningDismiss: { color: '#8A5300', fontWeight: '600', marginLeft: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 14, color: '#666', marginTop: 2 },
  logButton: {
    backgroundColor: '#2F6FED',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  logButtonDisabled: { backgroundColor: '#9BB4E8' },
  logButtonText: { color: '#FFF', fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 32, color: '#888' },
});

export default MedicationScheduleScreen;
