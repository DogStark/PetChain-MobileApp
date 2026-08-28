import React, { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { reminderService, type SnoozeDuration } from '../services/reminderService';
import { useAppTheme } from '../theme';

interface Props {
  visible: boolean;
  reminderId: string;
  nextDoseWindowMs?: number;
  onDismiss: () => void;
  onSnoozed: (until: Date) => void;
}

const QUICK_OPTIONS: { label: string; minutes: SnoozeDuration }[] = [
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
];

export default function ReminderSnoozeModal({
  visible,
  reminderId,
  nextDoseWindowMs,
  onDismiss,
  onSnoozed,
}: Props) {
  const colors = useAppTheme();
  const [custom, setCustom] = useState('');
  const [suggested, setSuggested] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;

    reminderService.getSuggestedTime(reminderId).then(setSuggested);
  }, [visible, reminderId]);

  const handleSnooze = async (minutes: SnoozeDuration) => {
    setLoading(true);

    try {
      const until = await reminderService.snooze(reminderId, minutes, nextDoseWindowMs);
      onSnoozed(until);
    } catch (error) {
      Alert.alert(
        'Cannot snooze',
        error instanceof Error ? error.message : 'Unable to snooze this reminder',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCustom = () => {
    const mins = parseInt(custom, 10);
    if (!Number.isFinite(mins) || mins < 1) {
      Alert.alert('Enter a valid duration in minutes');
      return;
    }

    handleSnooze(mins);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>Snooze Reminder</Text>

          {suggested && (
            <Text style={[styles.suggestion, { color: colors.info }]}>
              Based on your history, {suggested} works best.
            </Text>
          )}

          <View style={styles.options}>
            {QUICK_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.minutes}
                style={[styles.option, { backgroundColor: colors.infoMuted }]}
                onPress={() => handleSnooze(opt.minutes)}
                disabled={loading}
              >
                <Text style={[styles.optionText, { color: colors.info }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.customRow}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholderTextColor={colors.placeholder}
              placeholder="Custom minutes"
              keyboardType="numeric"
              value={custom}
              onChangeText={setCustom}
            />
            <TouchableOpacity
              style={[styles.customBtn, { backgroundColor: colors.info }]}
              onPress={handleCustom}
              disabled={loading}
            >
              <Text style={styles.customBtnText}>Snooze</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.dismiss} onPress={onDismiss}>
            <Text style={[styles.dismissText, { color: colors.secondaryText }]}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  suggestion: { fontSize: 13, marginBottom: 16 },
  options: { flexDirection: 'row', marginBottom: 16 },
  option: { flex: 1, borderRadius: 8, padding: 12, alignItems: 'center', marginRight: 10 },
  optionText: { fontWeight: '600' },
  customRow: { flexDirection: 'row', marginBottom: 16 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 10 },
  customBtn: { borderRadius: 8, padding: 10, justifyContent: 'center', marginLeft: 10 },
  customBtnText: { color: '#fff', fontWeight: '600' },
  dismiss: { alignItems: 'center', padding: 12 },
  dismissText: {},
});
