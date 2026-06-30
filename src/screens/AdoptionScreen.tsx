import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type { PetStackParamList } from '../navigation/types';
import {
  fetchMatchScore,
  type AdoptionMatchResult,
} from '../services/adoptionMatchingService';
import shelterIntegrationService, {
  type AdoptShelterPetResult,
  type BrowseShelterPetsFilters,
  type ShelterPet,
  type ShelterProvider,
  type ShelterSpecies,
} from '../services/shelterIntegrationService';

const PROVIDERS: ShelterProvider[] = ['petfinder', 'adopt-a-pet'];
const SPECIES_OPTIONS: Array<ShelterSpecies | 'all'> = ['all', 'dog', 'cat', 'rabbit', 'other'];

function ageLabel(months: number): string {
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder === 0 ? `${years} yr${years > 1 ? 's' : ''}` : `${years} yr ${remainder} mo`;
}

function providerLabel(provider: ShelterProvider): string {
  return provider === 'petfinder' ? 'Petfinder' : 'Adopt-a-Pet';
}

const AdoptionScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<PetStackParamList>>();
  const [filters, setFilters] = useState<BrowseShelterPetsFilters>({
    provider: 'petfinder',
    species: 'all',
    breed: '',
    location: '',
  });
  const [pets, setPets] = useState<ShelterPet[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPet, setSelectedPet] = useState<ShelterPet | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<Record<ShelterProvider, boolean>>({
    petfinder: false,
    'adopt-a-pet': false,
  });
  const [adopting, setAdopting] = useState(false);
  /** Map of shelterPetId → match result (lazy-loaded per card) */
  const [matchScores, setMatchScores] = useState<Record<string, AdoptionMatchResult>>({});
  const [matchBreakdownVisible, setMatchBreakdownVisible] = useState(false);

  const activeProvider = filters.provider ?? 'petfinder';

  useEffect(() => {
    let active = true;
    const loadPets = async () => {
      setLoading(true);
      try {
        const results = await shelterIntegrationService.browseAdoptablePets(filters);
        if (active) setPets(results);
      } catch (error) {
        console.warn('[Adoption] Failed to load shelter pets', error);
        if (active) {
          Alert.alert('Unable to load shelter pets', 'Please try again in a moment.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadPets();
    return () => {
      active = false;
    };
  }, [filters]);

  const connectProvider = async (provider: ShelterProvider) => {
    try {
      const { authorizationUrl } = await shelterIntegrationService.getShelterOAuthUrl(provider);
      setConnectedProviders((current) => ({ ...current, [provider]: true }));
      try {
        await Linking.openURL(authorizationUrl);
      } catch {
        // The mock auth URL is still useful even if it cannot be opened.
      }
      Alert.alert(
        `${providerLabel(provider)} connected`,
        'Mock OAuth is enabled in development, so browsing can continue immediately.',
      );
    } catch (error) {
      console.warn('[Adoption] OAuth setup failed', error);
      Alert.alert('Unable to connect provider', 'Please try again later.');
    }
  };

  const handleAdopt = async (pet: ShelterPet) => {
    if (adopting) return;

    setAdopting(true);
    try {
      const result: AdoptShelterPetResult = await shelterIntegrationService.adoptShelterPet({
        provider: pet.provider,
        shelterPetId: pet.id,
      });

      setSelectedPet(null);
      Alert.alert(
        'Pet profile created',
        `${result.pet.name} was added to PetChain and shelter records were transferred.`,
      );
      navigation.navigate('PetDetail', { petId: result.pet.id });
    } catch (error) {
      console.warn('[Adoption] Adoption flow failed', error);
      Alert.alert('Unable to complete adoption', 'Please try again shortly.');
    } finally {
      setAdopting(false);
    }
  };

  const renderProviderCard = (provider: ShelterProvider) => {
    const isConnected = connectedProviders[provider];
    return (
      <View key={provider} style={styles.providerCard}>
        <View>
          <Text style={styles.providerTitle}>{providerLabel(provider)}</Text>
          <Text style={styles.providerMeta}>
            {isConnected ? 'Connected' : 'Mock OAuth available'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.providerButton, isConnected && styles.providerButtonActive]}
          onPress={() => void connectProvider(provider)}
        >
          <Text style={styles.providerButtonText}>{isConnected ? 'Reconnect' : 'Connect'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  /** Lazily fetch match score for a pet (memoised). */
  const loadMatchScore = useCallback(
    async (petId: string) => {
      if (matchScores[petId]) return;
      const result = await fetchMatchScore(petId);
      if (result) {
        setMatchScores((prev) => ({ ...prev, [petId]: result }));
      }
    },
    [matchScores],
  );

  const selectedSummary = useMemo(() => {
    if (!selectedPet) return null;
    return [
      `${selectedPet.ageMonths} months old`,
      selectedPet.breed ?? 'Mixed breed',
      selectedPet.shelterName,
    ].join(' • ');
  }, [selectedPet]);

  /** Sort pets by match score descending (unscored pets go last) */
  const sortedPets = useMemo(
    () =>
      [...pets].sort((a, b) => {
        const sa = matchScores[a.id]?.score ?? -1;
        const sb = matchScores[b.id]?.score ?? -1;
        return sb - sa;
      }),
    [pets, matchScores],
  );

  const renderPet = ({ item }: { item: ShelterPet }) => {
    // Kick off lazy score fetch on first render of this card
    void loadMatchScore(item.id);
    const match = matchScores[item.id];
    const scoreColor =
      !match ? '#6b7280'
        : match.score >= 80 ? '#16a34a'
        : match.score >= 60 ? '#d97706'
        : '#dc2626';

    return (
      <TouchableOpacity style={styles.petCard} onPress={() => setSelectedPet(item)}>
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={styles.petImage} />
        ) : (
          <View style={[styles.petImage, styles.petImagePlaceholder]}>
            <Text style={styles.petEmoji}>🐾</Text>
          </View>
        )}
        <View style={styles.petBody}>
          <View style={styles.petHeaderRow}>
            <Text style={styles.petName}>{item.name}</Text>
            <Text style={styles.petAge}>{ageLabel(item.ageMonths)}</Text>
          </View>
          <Text style={styles.petMeta}>
            {item.species}
            {item.breed ? ` • ${item.breed}` : ''}
          </Text>
          <Text style={styles.petMeta}>{item.location}</Text>
          <Text style={styles.petDescription} numberOfLines={3}>
            {item.description}
          </Text>
          <View style={styles.tagRow}>
            <Text style={styles.tag}>{providerLabel(item.provider)}</Text>
            {item.adoptionFee ? <Text style={styles.tag}>{item.adoptionFee}</Text> : null}
            {/* Match score badge */}
            {match ? (
              <TouchableOpacity
                style={[styles.matchBadge, { backgroundColor: scoreColor }]}
                onPress={() => {
                  setSelectedPet(item);
                  setMatchBreakdownVisible(true);
                }}
              >
                <Text style={styles.matchBadgeText}>{match.score}% match</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.matchBadge, { backgroundColor: '#e5e7eb' }]}>
                <Text style={[styles.matchBadgeText, { color: '#9ca3af' }]}>…</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Shelter adoption</Text>
        <Text style={styles.title}>
          Find a pet, create their profile, and bring their records with them.
        </Text>
        <Text style={styles.subtitle}>
          Browse mock Petfinder and Adopt-a-Pet feeds in development, then transfer shelter
          vaccination and medical records into PetChain with Stellar anchoring.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Provider access</Text>
        {PROVIDERS.map(renderProviderCard)}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Filters</Text>
        <View style={styles.chipRow}>
          {PROVIDERS.map((provider) => {
            const selected = filters.provider === provider;
            return (
              <TouchableOpacity
                key={provider}
                style={[styles.chip, selected && styles.chipActive]}
                onPress={() => setFilters((current) => ({ ...current, provider }))}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                  {providerLabel(provider)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.chipRow}>
          {SPECIES_OPTIONS.map((species) => {
            const selected = filters.species === species || (!filters.species && species === 'all');
            return (
              <TouchableOpacity
                key={species}
                style={[styles.chip, selected && styles.chipActive]}
                onPress={() => setFilters((current) => ({ ...current, species }))}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                  {species === 'all'
                    ? 'All species'
                    : species.charAt(0).toUpperCase() + species.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={filters.breed ?? ''}
            onChangeText={(breed) => setFilters((current) => ({ ...current, breed }))}
            placeholder="Breed"
            placeholderTextColor="#8f8f8f"
          />
          <TextInput
            style={styles.input}
            value={filters.location ?? ''}
            onChangeText={(location) => setFilters((current) => ({ ...current, location }))}
            placeholder="City or ZIP"
            placeholderTextColor="#8f8f8f"
          />
        </View>
        <View style={styles.row}>
          <TextInput
            style={styles.smallInput}
            value={typeof filters.ageMinMonths === 'number' ? String(filters.ageMinMonths) : ''}
            onChangeText={(ageMinMonths) =>
              setFilters((current) => ({
                ...current,
                ageMinMonths: ageMinMonths.trim() ? Number(ageMinMonths) : undefined,
              }))
            }
            keyboardType="number-pad"
            placeholder="Min age mo"
            placeholderTextColor="#8f8f8f"
          />
          <TextInput
            style={styles.smallInput}
            value={typeof filters.ageMaxMonths === 'number' ? String(filters.ageMaxMonths) : ''}
            onChangeText={(ageMaxMonths) =>
              setFilters((current) => ({
                ...current,
                ageMaxMonths: ageMaxMonths.trim() ? Number(ageMaxMonths) : undefined,
              }))
            }
            keyboardType="number-pad"
            placeholder="Max age mo"
            placeholderTextColor="#8f8f8f"
          />
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() =>
              setFilters({
                provider: activeProvider,
                species: 'all',
                breed: '',
                location: '',
              })
            }
          >
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Adoptable pets</Text>
          <Text style={styles.countText}>{pets.length} found</Text>
        </View>
        {loading ? (
          <ActivityIndicator color="#0f766e" style={styles.loader} />
        ) : (
          <FlatList
            data={sortedPets}
            keyExtractor={(item) => item.id}
            renderItem={renderPet}
            scrollEnabled={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  try {
                    const results = await shelterIntegrationService.browseAdoptablePets(filters);
                    setPets(results);
                  } finally {
                    setRefreshing(false);
                  }
                }}
              />
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No adoptable pets matched these filters. Try widening the location or age range.
              </Text>
            }
          />
        )}
      </View>

      <Modal visible={Boolean(selectedPet)} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedPet ? (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>{selectedPet.name}</Text>
                    <Text style={styles.modalSubtitle}>{selectedSummary}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedPet(null)}>
                    <Text style={styles.closeText}>Close</Text>
                  </TouchableOpacity>
                </View>
                {selectedPet.photoUrl ? (
                  <Image source={{ uri: selectedPet.photoUrl }} style={styles.modalImage} />
                ) : null}
                <Text style={styles.modalDescription}>{selectedPet.description}</Text>
                <View style={styles.detailGrid}>
                  <Text style={styles.detailItem}>Location: {selectedPet.location}</Text>
                  <Text style={styles.detailItem}>Shelter: {selectedPet.shelterName}</Text>
                  <Text style={styles.detailItem}>Breed: {selectedPet.breed ?? 'Mixed'}</Text>
                  <Text style={styles.detailItem}>Age: {ageLabel(selectedPet.ageMonths)}</Text>
                </View>
                <Text style={styles.recordsTitle}>Shelter records to transfer</Text>
                {selectedPet.vaccinations.map((vaccination) => (
                  <Text key={vaccination.vaccineName} style={styles.recordItem}>
                    Vaccine: {vaccination.vaccineName}
                  </Text>
                ))}
                {selectedPet.medicalHistory.map((record) => (
                  <Text key={`${record.title}-${record.visitDate}`} style={styles.recordItem}>
                    {record.title}
                  </Text>
                ))}
                <TouchableOpacity
                  style={[styles.adoptButton, adopting && styles.adoptButtonDisabled]}
                  onPress={() => void handleAdopt(selectedPet)}
                  disabled={adopting}
                >
                  <Text style={styles.adoptButtonText}>
                    {adopting ? 'Creating profile…' : 'Adopt and create profile'}
                  </Text>
                </TouchableOpacity>

                {/* Why am I a good match? */}
                {selectedPet && matchScores[selectedPet.id] ? (
                  <View style={styles.whyMatchSection}>
                    <TouchableOpacity
                      style={styles.whyMatchHeader}
                      onPress={() => setMatchBreakdownVisible(true)}
                    >
                      <Text style={styles.whyMatchTitle}>Why am I a good match?</Text>
                      <Text style={styles.whyMatchChevron}>›</Text>
                    </TouchableOpacity>
                    <Text style={styles.whyMatchSub}>
                      {matchScores[selectedPet.id]!.score}% compatibility —{' '}
                      {matchScores[selectedPet.id]!.criteria.filter((c) => c.matched).length} of{' '}
                      {matchScores[selectedPet.id]!.criteria.length} criteria matched
                    </Text>
                  </View>
                ) : null}
                {selectedPet?.microchipId ? (
                  <Text style={styles.microchipText}>
                    Shelter microchip: {selectedPet.microchipId}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Match breakdown modal */}
      {selectedPet && matchScores[selectedPet.id] ? (
        <Modal
          visible={matchBreakdownVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setMatchBreakdownVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: 28 }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Match Breakdown</Text>
                  <Text style={styles.modalSubtitle}>{selectedPet.name}</Text>
                </View>
                <TouchableOpacity onPress={() => setMatchBreakdownVisible(false)}>
                  <Text style={styles.closeText}>Close</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.scoreCircleRow}>
                <View style={styles.scoreCircle}>
                  <Text style={styles.scoreCircleValue}>
                    {matchScores[selectedPet.id]!.score}%
                  </Text>
                  <Text style={styles.scoreCircleLabel}>match</Text>
                </View>
              </View>
              <ScrollView>
                {matchScores[selectedPet.id]!.criteria.map((c) => (
                  <View key={c.label} style={styles.criterionRow}>
                    <Text style={styles.criterionCheck}>{c.matched ? '✓' : '✗'}</Text>
                    <View style={styles.criterionBody}>
                      <Text style={[styles.criterionLabel, !c.matched && styles.criterionLabelFail]}>
                        {c.label}
                      </Text>
                      <Text style={styles.criterionExplanation}>{c.explanation}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7f2',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  hero: {
    backgroundColor: '#12372a',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  kicker: {
    color: '#9fd7c7',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#d7efe5',
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    marginBottom: 18,
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 16,
    shadowColor: '#0c1b14',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#143428',
    marginBottom: 12,
  },
  countText: {
    color: '#5f7368',
    fontWeight: '600',
  },
  providerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f3fbf7',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  providerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#12372a',
  },
  providerMeta: {
    color: '#61796f',
    marginTop: 4,
    fontSize: 12,
  },
  providerButton: {
    backgroundColor: '#0f766e',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  providerButtonActive: {
    backgroundColor: '#14532d',
  },
  providerButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    backgroundColor: '#f1f5f4',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#12372a',
  },
  chipText: {
    color: '#355045',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#f6f8f7',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#173428',
  },
  smallInput: {
    flex: 1,
    backgroundColor: '#f6f8f7',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#173428',
  },
  resetButton: {
    backgroundColor: '#e8efeb',
    borderRadius: 14,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  resetButtonText: {
    color: '#305145',
    fontWeight: '700',
  },
  loader: {
    paddingVertical: 20,
  },
  emptyText: {
    color: '#61796f',
    textAlign: 'center',
    paddingVertical: 18,
  },
  petCard: {
    flexDirection: 'row',
    backgroundColor: '#fbfcfb',
    borderRadius: 18,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#edf2ef',
  },
  petImage: {
    width: 104,
    height: 104,
    backgroundColor: '#dbe8e2',
  },
  petImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  petEmoji: {
    fontSize: 26,
  },
  petBody: {
    flex: 1,
    padding: 12,
  },
  petHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  petName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#12372a',
  },
  petAge: {
    color: '#0f766e',
    fontWeight: '700',
  },
  petMeta: {
    color: '#66796f',
    marginTop: 4,
    fontSize: 12,
  },
  petDescription: {
    color: '#355045',
    marginTop: 8,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tag: {
    backgroundColor: '#e5f4ef',
    color: '#14532d',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(10, 20, 16, 0.4)',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#12372a',
  },
  modalSubtitle: {
    marginTop: 4,
    color: '#618074',
  },
  closeText: {
    color: '#0f766e',
    fontWeight: '700',
  },
  modalImage: {
    width: '100%',
    height: 200,
    borderRadius: 18,
    marginBottom: 14,
  },
  modalDescription: {
    color: '#2e433a',
    lineHeight: 20,
    marginBottom: 14,
  },
  detailGrid: {
    gap: 8,
    marginBottom: 14,
  },
  detailItem: {
    color: '#485f56',
    fontWeight: '600',
  },
  recordsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#12372a',
    marginBottom: 8,
  },
  recordItem: {
    color: '#355045',
    marginBottom: 6,
  },
  adoptButton: {
    marginTop: 14,
    backgroundColor: '#12372a',
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 14,
  },
  adoptButtonDisabled: {
    opacity: 0.7,
  },
  adoptButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  microchipText: {
    marginTop: 10,
    color: '#61796f',
    fontSize: 12,
  },
  // Match score badge on cards
  matchBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  matchBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  // "Why am I a good match?" section
  whyMatchSection: {
    marginTop: 12,
    backgroundColor: '#f0fdf4',
    borderRadius: 14,
    padding: 14,
  },
  whyMatchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  whyMatchTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#14532d',
  },
  whyMatchChevron: {
    fontSize: 20,
    color: '#14532d',
  },
  whyMatchSub: {
    marginTop: 4,
    color: '#4b7a60',
    fontSize: 12,
  },
  // Score circle in breakdown modal
  scoreCircleRow: {
    alignItems: 'center',
    marginVertical: 16,
  },
  scoreCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#12372a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreCircleValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  scoreCircleLabel: {
    color: '#9fd7c7',
    fontSize: 11,
    fontWeight: '600',
  },
  // Criterion rows in breakdown
  criterionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  criterionCheck: {
    fontSize: 16,
    fontWeight: '800',
    color: '#16a34a',
    width: 18,
  },
  criterionBody: {
    flex: 1,
  },
  criterionLabel: {
    fontWeight: '700',
    color: '#12372a',
    marginBottom: 2,
  },
  criterionLabelFail: {
    color: '#dc2626',
  },
  criterionExplanation: {
    color: '#618074',
    fontSize: 12,
    lineHeight: 16,
  },
});

export default AdoptionScreen;
