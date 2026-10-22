import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Platform, Alert } from 'react-native';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

const NOTIFICATION_TYPES = [
  { key: 'medications', label: 'Medication reminders', emoji: '💊' },
  { key: 'appointments', label: 'Appointment alerts', emoji: '📅' },
  { key: 'health', label: 'Health check-ins', emoji: '❤️' },
  { key: 'emergency', label: 'Emergency alerts', emoji: '🚨' },
];

const NotificationsStep: React.FC<Props> = ({ onNext, onSkip }) => {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    medications: true,
    appointments: true,
    health: false,
    emergency: true,
  });

  const toggle = (key: string) => setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const handleEnable = () => {
    // On a real device this would call Notifications.requestPermissionsAsync()
    if (Platform.OS !== 'web') {
      Alert.alert('Notifications', 'Permission request would appear here on a real device.');
    }
    onNext();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🔔</Text>
      <Text style={styles.title}>Stay in the Loop</Text>
      <Text style={styles.subtitle}>Choose which notifications you'd like to receive.</Text>

      <View style={styles.list}>
        {NOTIFICATION_TYPES.map(({ key, label, emoji }) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowEmoji}>{emoji}</Text>
            <Text style={styles.rowLabel}>{label}</Text>
            <Switch
              value={prefs[key]}
              onValueChange={() => toggle(key)}
              trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
              thumbColor="#fff"
              accessibilityLabel={label}
            />
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.primary} onPress={handleEnable} accessibilityRole="button">
        <Text style={styles.primaryText}>Enable Notifications</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSkip} accessibilityRole="button">
        <Text style={styles.skip}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emoji: { fontSize: 72, marginBottom: 16 },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 28 },
  list: { width: '100%', marginBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rowEmoji: { fontSize: 22, marginRight: 12 },
  rowLabel: { flex: 1, fontSize: 15, color: '#1F2937' },
  primary: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skip: { color: '#6B7280', fontSize: 15 },
});

export default NotificationsStep;
