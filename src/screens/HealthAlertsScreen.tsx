import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
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
import { useSecureScreen } from '../utils/secureScreen';

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

  const load = useCallback(async () => {
    const next = await getHealthAlerts('active');
    setAlerts(next);
  }, []);

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
});

export default HealthAlertsScreen;
