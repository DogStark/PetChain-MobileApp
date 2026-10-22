import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

const PET_TYPES = ['🐕 Dog', '🐈 Cat', '🐇 Rabbit', '🐦 Bird', '🐠 Fish', '🦎 Other'];

const PetSetupStep: React.FC<Props> = ({ onNext, onSkip }) => {
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.emoji}>🐶</Text>
      <Text style={styles.title}>Set Up Your Pet</Text>
      <Text style={styles.subtitle}>Tell us about your furry (or scaly) friend.</Text>

      <TextInput
        style={styles.input}
        placeholder="Pet's name"
        placeholderTextColor="#9CA3AF"
        value={name}
        onChangeText={setName}
        accessibilityLabel="Pet name input"
      />

      <Text style={styles.label}>Pet type</Text>
      <View style={styles.typeGrid}>
        {PET_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.typeChip, selectedType === type && styles.typeChipSelected]}
            onPress={() => setSelectedType(type)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedType === type }}
          >
            <Text style={[styles.typeText, selectedType === type && styles.typeTextSelected]}>
              {type}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.primary} onPress={onNext} accessibilityRole="button">
        <Text style={styles.primaryText}>{name ? 'Continue' : 'Continue'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSkip} accessibilityRole="button">
        <Text style={styles.skip}>Skip — I'll add pets later</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  emoji: { fontSize: 72, marginBottom: 16 },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 24 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1F2937',
    marginBottom: 20,
  },
  label: {
    alignSelf: 'flex-start',
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 32, width: '100%' },
  typeChip: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typeChipSelected: { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  typeText: { fontSize: 14, color: '#6B7280' },
  typeTextSelected: { color: '#3B82F6', fontWeight: '600' },
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

export default PetSetupStep;
