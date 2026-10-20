import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  buildNotificationTroubleshootingReport,
  type NotificationTroubleshootingReport,
} from '../utils/notificationTroubleshooting';
import { describeNotificationDeliveryState, type PermissionStatus } from '../utils/permissions';

interface Props {
  onBack: () => void;
}

const PERMISSION_LABELS: Record<PermissionStatus, string> = {
  granted: 'Allowed',
  denied: 'Off',
  restricted: 'Restricted',
  limited: 'Limited',
  undetermined: 'Not set',
};

const formatTimestamp = (ms: number): string => new Date(ms).toLocaleString();

/**
 * Explains why care reminders may not be arriving. Shows settings only: no
 * notification content, pet names, or medical details are rendered here.
 */
const NotificationTroubleshootingScreen: React.FC<Props> = ({ onBack }) => {
  const [report, setReport] = useState<NotificationTroubleshootingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setReport(await buildNotificationTroubleshootingReport());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const renderServerStatus = (value: NotificationTroubleshootingReport) => {
    if (!value.snapshot) {
      return 'No server-confirmed settings yet. Connect to the internet and tap Retry.';
    }
    const reminders = value.snapshot.remindersEnabled ? 'On' : 'Off';
    const checked = formatTimestamp(value.snapshot.fetchedAt);
    if (value.snapshotFromCache) {
      return `Last known: care reminders ${reminders}, checked ${checked}. Not confirmed by the server right now.`;
    }
    return `Confirmed by the server: care reminders ${reminders}, checked ${checked}.`;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          size="large"
          color="#4CAF50"
          accessibilityLabel="Checking notification delivery"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">
          Notification Delivery
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {failed || !report ? (
          <View style={styles.card}>
            <Text style={styles.message} accessibilityLiveRegion="polite">
              We could not check notification delivery. Tap Retry to try again.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionHeader} accessibilityRole="header">
              Device permission
            </Text>
            <View style={styles.card}>
              <Text style={styles.rowLabel}>
                Status: {PERMISSION_LABELS[report.permission.osStatus]}
              </Text>
              <Text style={styles.message} accessibilityLiveRegion="polite">
                {describeNotificationDeliveryState(report.permission.reason) ??
                  'Notifications are allowed and confirmed by the server. Care reminders can be delivered.'}
              </Text>
            </View>

            <Text style={styles.sectionHeader} accessibilityRole="header">
              Server settings
            </Text>
            <View style={styles.card}>
              <Text style={styles.message}>{renderServerStatus(report)}</Text>
              {report.isStale && (
                <Text style={styles.warning} accessibilityLiveRegion="polite">
                  This information is more than a day old. Tap Retry when you are online.
                </Text>
              )}
            </View>

            {report.channels.length > 0 && (
              <>
                <Text style={styles.sectionHeader} accessibilityRole="header">
                  Notification channels
                </Text>
                <View style={styles.card}>
                  {report.channels.map((channel) => (
                    <View key={channel.id} style={styles.row}>
                      <Text style={styles.rowLabel}>{channel.name}</Text>
                      <Text style={styles.rowValue}>{channel.enabled ? 'On' : 'Off'}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.sectionHeader} accessibilityRole="header">
              How to fix it
            </Text>
            <View style={styles.card}>
              {report.steps.map((step, index) => (
                <Text key={step} style={styles.message}>
                  {`${index + 1}. ${step}`}
                </Text>
              ))}
            </View>
          </>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Retry notification check"
        >
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={() => void Linking.openSettings().catch(() => undefined)}
          accessibilityRole="button"
          accessibilityLabel="Open system settings"
        >
          <Text style={styles.buttonText}>Open system settings</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          This screen shows notification settings only. Notification content and pet details are
          never shown here.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 12,
  },
  backText: {
    fontSize: 16,
    color: '#4CAF50',
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  content: {
    padding: 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  rowValue: {
    fontSize: 16,
    color: '#555',
  },
  message: {
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
    marginBottom: 6,
  },
  warning: {
    fontSize: 14,
    color: '#B26A00',
    fontWeight: '600',
  },
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 10,
    marginTop: 16,
  },
  buttonText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '600',
  },
  footnote: {
    fontSize: 12,
    color: '#888',
    marginTop: 16,
  },
});

export default NotificationTroubleshootingScreen;
