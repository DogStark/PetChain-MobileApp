import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import breedInsightsService, {
  type PetBreedInsights,
  type BreedInsight,
} from '../services/breedInsightsService';
import petService, { type Pet } from '../services/petService';
import { formatLocalDate } from '../utils/dateLocale';
import { formatWeight, weightUnit } from '../utils/localeValues';
import { getPhoto } from '../utils/petPhotoStore';
import { useSecureScreen } from '../utils/secureScreen';

interface Props {
  petId: string;
  onBack: () => void;
}

const PetProfileScreen: React.FC<Props> = ({ petId, onBack }) => {
  useSecureScreen();

  const [pet, setPet] = useState<Pet | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [breedText, setBreedText] = useState('');
  const [breedSuggestions, setBreedSuggestions] = useState<string[]>([]);
  const [breedList, setBreedList] = useState<BreedInsight[]>([]);
  const [insights, setInsights] = useState<PetBreedInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadBreedList = useCallback(async () => {
    try {
      const list = await breedInsightsService.getBreedList();
      setBreedList(list);
    } catch {
      setBreedList([]);
    }
  }, []);

  const loadPet = useCallback(async () => {
    try {
      const [data, uri] = await Promise.all([petService.getPetById(petId), getPhoto(petId)]);
      setPet(data);
      setBreedText(data.breed ?? '');
      setPhotoUri(uri);
    } catch {
      Alert.alert('Error', 'Unable to load pet profile.');
    } finally {
      setLoading(false);
    }
  }, [petId]);

  useEffect(() => {
    void Promise.all([loadPet(), loadBreedList()]);
  }, [loadPet, loadBreedList]);

  useEffect(() => {
    if (!pet) return;

    void (async () => {
      try {
        const result = await breedInsightsService.getBreedInsightsForPet({
          breed: breedText || pet.breed,
          species: pet.species,
          dateOfBirth: pet.dateOfBirth,
          weightKg: pet.weightKg,
        });
        setInsights(result);
      } catch {
        setInsights(null);
      }
    })();
  }, [breedText, pet]);

  const updateBreedField = (value: string) => {
    setBreedText(value);
    const normalized = value.trim().toLowerCase();

    if (!normalized) {
      setBreedSuggestions([]);
      return;
    }

    setBreedSuggestions(
      breedList
        .filter((breed) => breed.name.toLowerCase().includes(normalized))
        .slice(0, 8)
        .map((breed) => breed.name),
    );
  };

  const selectBreedSuggestion = (breed: string) => {
    setBreedText(breed);
    setBreedSuggestions([]);
  };

  const detectedBreed = useMemo(() => {
    if (!photoUri || breedList.length === 0) return undefined;
    const lowerSource = photoUri.toLowerCase();
    return breedList.find((breed) => lowerSource.includes(breed.name.toLowerCase()));
  }, [photoUri, breedList]);

  const detectBreedFromPhoto = () => {
    if (!photoUri) {
      Alert.alert('No photo', 'Upload or add a pet photo to detect the breed from the image URI.');
      return;
    }

    if (!breedList.length) {
      Alert.alert('Breed lookup unavailable', 'Breed data is unavailable right now.');
      return;
    }

    if (detectedBreed) {
      setBreedText(detectedBreed.name);
      setBreedSuggestions([]);
      Alert.alert('Breed detected', `Suggested breed: ${detectedBreed.name}`);
      return;
    }

    Alert.alert(
      'Unable to detect breed',
      'No likely breed was found in the photo URI. You can search breeds manually.',
    );
  };

  const saveBreedUpdate = async () => {
    if (!pet) return;
    setSaving(true);

    try {
      const updated = await petService.updatePet(pet.id, {
        breed: breedText.trim() || undefined,
      });
      setPet(updated);
      setBreedText(updated.breed ?? '');
      Alert.alert('Saved', 'Breed details have been updated.');
    } catch {
      Alert.alert('Error', 'Unable to save the breed profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !pet) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{pet.name}'s Profile</Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.photoCard}>
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={styles.photo}
              accessibilityLabel={`${pet.name} photo`}
            />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Text style={styles.photoEmoji}>🐾</Text>
            </View>
          )}
          <Text style={styles.photoHint}>
            {photoUri
              ? 'Photo available for breed detection.'
              : 'Add a photo in the pet editor to enable breed detection.'}
          </Text>
          <TouchableOpacity
            style={styles.detectBtn}
            onPress={detectBreedFromPhoto}
            accessibilityRole="button"
          >
            <Text style={styles.detectBtnText}>Detect Breed from Photo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Breed Selection</Text>
          <TextInput
            style={styles.input}
            placeholder="Search or type breed"
            value={breedText}
            onChangeText={updateBreedField}
            placeholderTextColor="#999"
            accessibilityLabel="Breed"
            returnKeyType="done"
          />
          {breedSuggestions.length > 0 && (
            <View style={styles.suggestionsCard}>
              {breedSuggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion}
                  onPress={() => selectBreedSuggestion(suggestion)}
                  style={styles.suggestionChip}
                >
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={saveBreedUpdate}
            disabled={saving}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Breed'}</Text>
          </TouchableOpacity>
        </View>

        {insights ? (
          <View style={styles.insightsCard}>
            <Text style={styles.sectionTitle}>Breed Insights</Text>
            <Text style={styles.insightText}>Breed: {insights.breedDisplay}</Text>
            <Text style={styles.insightText}>
              Estimated life expectancy: {insights.lifeExpectancyLabel}
            </Text>
            <Text style={[styles.subTitle, styles.marginTop]}>Common health risks</Text>
            {insights.healthRisks.length > 0 ? (
              insights.healthRisks.map((risk) => (
                <Text key={risk} style={styles.bullet}>
                  • {risk}
                </Text>
              ))
            ) : (
              <Text style={styles.bullet}>• No breed-specific risks available.</Text>
            )}
            <Text style={[styles.subTitle, styles.marginTop]}>Care recommendations</Text>
            {insights.careRecommendations.map((tip) => (
              <Text key={tip} style={styles.bullet}>
                • {tip}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Pet Summary</Text>
          <Text style={styles.summaryLine}>Species: {pet.species}</Text>
          <Text style={styles.summaryLine}>
            Weight: {pet.weightKg ? formatWeight(pet.weightKg) : 'Unknown'}{' '}
            {pet.weightKg ? weightUnit() : ''}
          </Text>
          <Text style={styles.summaryLine}>
            Born: {pet.dateOfBirth ? formatLocalDate(pet.dateOfBirth) : 'Unknown'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtn: { padding: 6 },
  backText: { fontSize: 18, color: '#4CAF50' },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  photoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  photo: { width: 140, height: 140, borderRadius: 70, marginBottom: 12 },
  photoPlaceholder: { backgroundColor: '#e8f5e9', justifyContent: 'center', alignItems: 'center' },
  photoEmoji: { fontSize: 48 },
  photoHint: { color: '#666', textAlign: 'center', marginBottom: 12 },
  detectBtn: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  detectBtnText: { color: '#fff', fontWeight: '700' },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10, color: '#1a1a1a' },
  input: {
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#1a1a1a',
  },
  suggestionsCard: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  suggestionChip: {
    backgroundColor: '#f1f8e9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  suggestionText: { color: '#33691e', fontWeight: '600' },
  saveBtn: {
    marginTop: 16,
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  insightsCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  insightText: { color: '#333', fontSize: 14, marginBottom: 8 },
  subTitle: { color: '#666', fontWeight: '700', marginTop: 12, marginBottom: 8 },
  bullet: { color: '#444', fontSize: 14, marginBottom: 6, marginLeft: 8 },
  marginTop: { marginTop: 12 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 32 },
  summaryLine: { color: '#444', fontSize: 14, marginBottom: 8 },
});

export default PetProfileScreen;
