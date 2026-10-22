/**
 * PetSelectorBar — Issue #151/#82: Multiple pets support
 *
 * A horizontal scrollable bar that lets the user switch between their pets.
 * Renders at the top of any screen that needs per-pet context.
 */

import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { usePetContext } from '../context/PetContext';
import type { Pet } from '../services/petService';

interface Props {
  onAddPet?: () => void;
}

const PetSelectorBar: React.FC<Props> = ({ onAddPet }) => {
  const { pets, activePet, loading, setActivePet } = usePetContext();

  if (loading && pets.length === 0) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        accessibilityRole="tablist"
      >
        {pets.map((pet: Pet) => {
          const isActive = activePet?.id === pet.id;
          return (
            <TouchableOpacity
              key={pet.id}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => setActivePet(pet)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`Select ${pet.name}`}
            >
              <Text style={styles.chipEmoji}>
                {pet.species === 'dog'
                  ? '🐶'
                  : pet.species === 'cat'
                    ? '🐱'
                    : pet.species === 'bird'
                      ? '🐦'
                      : pet.species === 'rabbit'
                        ? '🐰'
                        : '🐾'}
              </Text>
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{pet.name}</Text>
            </TouchableOpacity>
          );
        })}

        {onAddPet && (
          <TouchableOpacity
            style={styles.addChip}
            onPress={onAddPet}
            accessibilityRole="button"
            accessibilityLabel="Add new pet"
          >
            <Text style={styles.addChipText}>+ Add</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  loadingRow: {
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  scroll: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#f9f9f9',
  },
  chipActive: {
    borderColor: '#4CAF50',
    backgroundColor: '#e8f5e9',
  },
  chipEmoji: { fontSize: 16 },
  chipText: { fontSize: 13, fontWeight: '500', color: '#555' },
  chipTextActive: { color: '#2e7d32', fontWeight: '700' },
  addChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    backgroundColor: '#fff',
  },
  addChipText: { fontSize: 13, fontWeight: '600', color: '#4CAF50' },
});

export default PetSelectorBar;
