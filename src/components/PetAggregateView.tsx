/**
 * PetAggregateView — Issue #151/#82: Multiple pets support
 *
 * Shows a summary card for each pet with quick-access stats,
 * providing an aggregate overview across all pets in one account.
 */

import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';

import { usePetContext } from '../context/PetContext';
import type { Pet } from '../services/petService';

interface PetCardProps {
  pet: Pet;
  isActive: boolean;
  onSelect: (pet: Pet) => void;
}

const PetCard: React.FC<PetCardProps> = ({ pet, isActive, onSelect }) => (
  <TouchableOpacity
    style={[styles.card, isActive && styles.cardActive]}
    onPress={() => onSelect(pet)}
    accessibilityRole="button"
    accessibilityLabel={`${pet.name}, ${pet.species}${isActive ? ', currently selected' : ''}`}
  >
    <Text style={styles.cardEmoji}>
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
    <Text style={styles.cardName} numberOfLines={1}>
      {pet.name}
    </Text>
    <Text style={styles.cardSpecies}>{pet.species}</Text>
    {pet.breed ? (
      <Text style={styles.cardBreed} numberOfLines={1}>
        {pet.breed}
      </Text>
    ) : null}
    {isActive && <View style={styles.activeDot} />}
  </TouchableOpacity>
);

interface Props {
  onSelectPet?: (pet: Pet) => void;
}

const PetAggregateView: React.FC<Props> = ({ onSelectPet }) => {
  const { pets, activePet, loading, error, setActivePet, totalPets } = usePetContext();

  const handleSelect = (pet: Pet) => {
    setActivePet(pet);
    onSelectPet?.(pet);
  };

  if (loading && pets.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (error && pets.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load pets.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>All Pets</Text>
        <Text style={styles.headerCount}>
          {totalPets} pet{totalPets !== 1 ? 's' : ''}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {pets.map((pet) => (
          <PetCard
            key={pet.id}
            pet={pet}
            isActive={activePet?.id === pet.id}
            onSelect={handleSelect}
          />
        ))}
      </ScrollView>

      {activePet && (
        <View style={styles.activeInfo}>
          <Text style={styles.activeLabel}>Viewing:</Text>
          <Text style={styles.activeName}>{activePet.name}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  center: { padding: 24, alignItems: 'center' },
  errorText: { color: '#e53e3e', fontSize: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  headerCount: { fontSize: 13, color: '#888' },
  scroll: { gap: 10, paddingBottom: 4 },
  card: {
    width: 90,
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
    position: 'relative',
  },
  cardActive: {
    borderColor: '#4CAF50',
    backgroundColor: '#e8f5e9',
  },
  cardEmoji: { fontSize: 28, marginBottom: 4 },
  cardName: { fontSize: 13, fontWeight: '700', color: '#1a1a1a', textAlign: 'center' },
  cardSpecies: { fontSize: 11, color: '#888', marginTop: 2, textTransform: 'capitalize' },
  cardBreed: { fontSize: 10, color: '#aaa', marginTop: 1, textAlign: 'center' },
  activeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
  },
  activeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  activeLabel: { fontSize: 13, color: '#888' },
  activeName: { fontSize: 13, fontWeight: '700', color: '#2e7d32' },
});

export default PetAggregateView;
