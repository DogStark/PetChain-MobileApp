import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  dismissHealthAlert,
  getHealthAlerts,
  runDailyHealthPredictions,
  type HealthAlertFeedback,
  type HealthPredictionAlert,
} from '../services/healthAlertService';
import {
  getCareReminderQuietHours,
  getNextEligibleDeliveryTime,
  updateCareReminderQuietHours,
  type QuietHoursSettings,
} from '../services/notificationService';
import { useSecureScreen } from '../utils/secureScreen';

const QUIET_HOUR_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
}

function formatDeliveryTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function riskPercent(alert: HealthPredictionAlert): string {
  return `${Math.round(alert.riskScore * 100)}%`;
}

const feedbackOptions: Array<{ label: string; value: HealthAlertFeedback }> = [
  { label: 'Helpful', value: 'helpful' },
  { label: 'Known', value: 'already_known' },
  { label: 'False alarm', value: 'false_alarm' },
];

const HealthAlertsScreen: React.FC = () => {
  useSecureScreen();

  const [alerts, setAlerts] = useState<HealthPredictionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);

  const [quietHours, setQuietHours] = useState<QuietHoursSettings | null>(null);
  const [quietHoursLoading, setQuietHoursLoading] = useState(true);
  const [quietHoursSaving, setQuietHoursSaving] = useState(false);
  const [quietHoursOffline, setQuietHoursOffline] = useState(false);
  const [timeZone, setTimeZone] = useState(currentTimeZone);
  const [reduceMotion, setReduceMotion] = useState(false);

  const load = useCallback(async () => {
    const next = await getHealthAlerts('active');
    setAlerts(next);
  }, []);

  const loadQuietHours = useCallback(async () => {
    try {
      const settings = await getCareReminderQuietHours();
      setQuietHours(settings);
      setQuietHoursOffline(false);
    } catch {
      // Preserve whatever cached settings we already have and flag the offline state.
      setQuietHoursOffline(true);
    } finally {
      setQuietHoursLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuietHours();
  }, [loadQuietHours]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  // Recompute the next eligible delivery time whenever the device timezone changes.
  useEffect(() => {
    const interval = setInterval(() => {
      const next = currentTimeZone();
      setTimeZone((previous) => (previous === next ? previous : next));
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const nextEligibleDelivery = useMemo(() => {
    if (!quietHours) {
      return null;
    }
    try {
      return getNextEligibleDeliveryTime(quietHours, new Date(), timeZone);
    } catch {
      return null;
    }
  }, [quietHours, timeZone]);

  const saveQuietHours = async (next: QuietHoursSettings) => {
    const previous = quietHours;
    setQuietHours(next);
    setQuietHoursSaving(true);
    try {
      const confirmed = await updateCareReminderQuietHours(next);
      setQuietHours(confirmed);
      setQuietHoursOffline(false);
    } catch (error) {
      setQuietHours(previous);
      Alert.alert(
        'Could not save quiet hours',
        error instanceof Error ? error.message : 'Unable to update care reminder quiet hours.',
      );
    } finally {
      setQuietHoursSaving(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (error) {
        Alert.alert(
          'Health alerts unavailable',
          error instanceof Error ? error.message : 'Unable to load predictive health alerts.',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const runPredictions = async () => {
    setRunning(true);
    try {
      await runDailyHealthPredictions();
      await load();
    } catch (error) {
      Alert.alert(
        'Prediction failed',
        error instanceof Error ? error.message : 'Unable to run health predictions.',
      );
    } finally {
      setRunning(false);
    }
  };

  const dismiss = async (id: string, feedback: HealthAlertFeedback) => {
    try {
      await dismissHealthAlert(id, feedback);
      setAlerts((current) => current.filter((alert) => alert.id !== id));
    } catch (error) {
      Alert.alert(
        'Dismiss failed',
        error instanceof Error ? error.message : 'Unable to dismiss this alert.',
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#4CAF50" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Health Alerts</Text>
        <TouchableOpacity
          style={[styles.runButton, running && styles.disabledButton]}
          onPress={() => void runPredictions()}
          disabled={running}
        >
          <Text style={styles.runButtonText}>{running ? 'Running' : 'Run'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.quietCard}>
        <View style={styles.quietHeaderRow}>
          <Text style={styles.sectionLabel}>Care reminder quiet hours</Text>
          {quietHoursLoading ? <ActivityIndicator color="#4CAF50" /> : null}
        </View>

        {quietHoursOffline ? (
          <Text style={styles.offlineText} accessibilityLiveRegion="polite">
            Offline — showing your last saved quiet hours. Changes will sync when you reconnect.
          </Text>
        ) : null}

        {quietHours ? (
          <>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Enable quiet hours</Text>
              <Switch
                value={quietHours.enabled}
                disabled={quietHoursSaving}
                onValueChange={(enabled) => void saveQuietHours({ ...quietHours, enabled })}
                accessibilityRole="switch"
                accessibilityLabel="Enable care reminder quiet hours"
                accessibilityHint="When enabled, care reminders are deferred during the quiet period."
                accessibilityState={{ checked: quietHours.enabled, disabled: quietHoursSaving }}
              />
            </View>

            <Text style={styles.quietHelp}>
              Reminders that fall inside your quiet period are held and delivered at the next
              eligible time instead of being lost.
            </Text>

            <Text style={styles.pickerLabel} accessibilityRole="header">
              Quiet period starts
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hourRow}
            >
              {QUIET_HOUR_OPTIONS.map((hour) => {
                const selected = quietHours.startHour === hour;
                return (
                  <TouchableOpacity
                    key={`start-${hour}`}
                    style={[styles.hourChip, selected && styles.hourChipSelected]}
                    disabled={quietHoursSaving || !quietHours.enabled}
                    onPress={() => void saveQuietHours({ ...quietHours, startHour: hour })}
                    accessibilityRole="button"
                    accessibilityLabel={`Start quiet hours at ${formatHour(hour)}`}
                    accessibilityState={{ selected, disabled: quietHoursSaving || !quietHours.enabled }}
                  >
                    <Text style={[styles.hourChipText, selected && styles.hourChipTextSelected]}>
                      {formatHour(hour)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.pickerLabel} accessibilityRole="header">
              Quiet period ends
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hourRow}
            >
              {QUIET_HOUR_OPTIONS.map((hour) => {
                const selected = quietHours.endHour === hour;
                return (
                  <TouchableOpacity
                    key={`end-${hour}`}
                    style={[styles.hourChip, selected && styles.hourChipSelected]}
                    disabled={quietHoursSaving || !quietHours.enabled}
                    onPress={() => void saveQuietHours({ ...quietHours, endHour: hour })}
                    accessibilityRole="button"
                    accessibilityLabel={`End quiet hours at ${formatHour(hour)}`}
                    accessibilityState={{ selected, disabled: quietHoursSaving || !quietHours.enabled }}
                  >
                    <Text style={[styles.hourChipText, selected && styles.hourChipTextSelected]}>
                      {formatHour(hour)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.nextDeliveryText} accessibilityLiveRegion="polite">
              {quietHours.enabled && nextEligibleDelivery
                ? `Next eligible delivery: ${formatDeliveryTime(nextEligibleDelivery)} (${timeZone})`
                : 'Reminders are delivered immediately.'}
            </Text>
          </>
        ) : !quietHoursLoading ? (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setQuietHoursLoading(true);
              void loadQuietHours();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading quiet hours"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {alerts.length ? (
        alerts.map((alert) => (
          <View key={alert.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.riskBadge}>
                <Text style={styles.riskValue}>{riskPercent(alert)}</Text>
                <Text style={styles.riskLabel}>{alert.riskLevel}</Text>
              </View>
              <View style={styles.alertTitleWrap}>
                <Text style={styles.alertTitle}>{alert.predictedIssue}</Text>
                <Text style={styles.alertDate}>Generated {formatDate(alert.createdAt)}</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Contributing factors</Text>
            <View style={styles.factorList}>
              {alert.contributingFactors.map((factor) => (
                <Text key={factor} style={styles.factorChip}>
                  {factor}
                </Text>
              ))}
            </View>

            <Text style={styles.modelText}>Model {alert.modelVersion}</Text>

            <View style={styles.feedbackRow}>
              {feedbackOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.feedbackButton}
                  onPress={() => void dismiss(alert.id, option.value)}
                >
                  <Text style={styles.feedbackButtonText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No active predictive alerts</Text>
          <Text style={styles.emptyText}>
            Daily predictions will appear here when vitals indicate elevated risk.
          </Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 18, paddingBottom: 36 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  heading: { fontSize: 22, fontWeight: '700', color: '#111' },
  runButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disabledButton: { opacity: 0.6 },
  runButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  riskBadge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#b71c1c',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  riskValue: { color: '#fff', fontSize: 20, fontWeight: '800' },
  riskLabel: { color: '#fff', fontSize: 11, textTransform: 'uppercase', marginTop: 2 },
  alertTitleWrap: { flex: 1 },
  alertTitle: { color: '#111', fontSize: 16, fontWeight: '700', textTransform: 'capitalize' },
  alertDate: { color: '#777', fontSize: 12, marginTop: 4 },
  sectionLabel: { color: '#555', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  factorList: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  factorChip: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#334155',
    fontSize: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  modelText: { color: '#777', fontSize: 12, marginBottom: 12 },
  feedbackRow: { flexDirection: 'row', flexWrap: 'wrap' },
  feedbackButton: {
    backgroundColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  feedbackButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  emptyTitle: { color: '#111', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyText: { color: '#666', fontSize: 14, lineHeight: 20 },
  quietCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  quietHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  offlineText: { color: '#b45309', fontSize: 12, marginBottom: 10 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  toggleLabel: { color: '#111', fontSize: 14, fontWeight: '600' },
  quietHelp: { color: '#666', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  pickerLabel: { color: '#555', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  hourRow: { paddingBottom: 12 },
  hourChip: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  hourChipSelected: { backgroundColor: '#4CAF50' },
  hourChipText: { color: '#334155', fontSize: 12, fontWeight: '600' },
  hourChipTextSelected: { color: '#fff' },
  nextDeliveryText: { color: '#111', fontSize: 13, fontWeight: '600', marginTop: 4 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

export default HealthAlertsScreen;
