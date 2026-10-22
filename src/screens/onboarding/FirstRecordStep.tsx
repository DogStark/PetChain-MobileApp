import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

const RECORD_TYPES = [
  { emoji: '💉', label: 'Vaccination' },
  { emoji: '🩺', label: 'Vet Visit' },
  { emoji: '💊', label: 'Medication' },
  { emoji: '📋', label: 'Lab Results' },
];

const FirstRecordStep: React.FC<Props> = ({ onNext, onSkip }) => (
  <View style={styles.container}>
    <Text style={styles.emoji}>📋</Text>
    <Text style={styles.title}>Add Your First Record</Text>
    <Text style={styles.subtitle}>
      Start building your pet's health history. You can add records manually or scan a QR code.
    </Text>

    <View style={styles.grid}>
      {RECORD_TYPES.map(({ emoji, label }) => (
        <View key={label} style={styles.card}>
          <Text style={styles.cardEmoji}>{emoji}</Text>
          <Text style={styles.cardLabel}>{label}</Text>
        </View>
      ))}
    </View>

    <TouchableOpacity style={styles.primary} onPress={onNext} accessibilityRole="button">
      <Text style={styles.primaryText}>Add a Record</Text>
    </TouchableOpacity>
    <TouchableOpacity onPress={onSkip} accessibilityRole="button">
      <Text style={styles.skip}>I'll do this later</Text>
    </TouchableOpacity>
  </View>
);

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
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 36,
    justifyContent: 'center',
  },
  card: {
    width: 120,
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardEmoji: { fontSize: 32, marginBottom: 6 },
  cardLabel: { fontSize: 13, color: '#374151', fontWeight: '500' },
  primary: {
    backgroundColor: '#10B981',
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

export default FirstRecordStep;
