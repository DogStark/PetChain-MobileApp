import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
  const [loadError, setLoadError] = useState(false);

  // Tracks the last announced status so loading/empty/error states are only
  // announced once per transition (avoids duplicate VoiceOver/TalkBack chatter).
  const lastAnnouncedStatus = useRef<string | null>(null);

  const announceOnce = useCallback((key: string, message: string) => {
    if (lastAnnouncedStatus.current === key) return;
    lastAnnouncedStatus.current = key;
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

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
      setLoadError(false);
    } catch {
      setLoadError(true);
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

  // Announce loading, error, and ready states exactly once per transition.
  useEffect(() => {
    if (loading) {
      announceOnce('loading', 'Loading pet profile.');
      return;
    }
    if (loadError) {
      announceOnce('error', 'Unable to load pet profile.');
      return;
    }
    if (pet) {
      announceOnce('ready', `${pet.name} profile loaded.`);
    }
  }, [loading, loadError, pet, announceOnce]);

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
      <View
        style={styles.loadingContainer}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading pet profile"
      >
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
            accessibilityHint="Returns to the previous screen"
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title} accessibilityRole="header">
            {pet.name}'s Profile
          </Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.photoCard}>
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={styles.photo}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${pet.name} photo`}
            />
          ) : (
            <View
              style={[styles.photo, styles.photoPlaceholder]}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
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
            accessibilityLabel="Detect breed from photo"
            accessibilityHint="Suggests a breed based on the current pet photo"
          >
            <Text style={styles.detectBtnText}>Detect Breed from Photo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Breed Selection
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Search or type breed"
            value={breedText}
            onChangeText={updateBreedField}
            placeholderTextColor="#999"
            accessibilityLabel="Breed"
            accessibilityHint="Search or type the pet's breed"
            returnKeyType="done"
          />
          {breedSuggestions.length > 0 && (
            <View style={styles.suggestionsCard}>
              {breedSuggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion}
                  onPress={() => selectBreedSuggestion(suggestion)}
                  style={styles.suggestionChip}
                  accessibilityRole="button"
                  accessibilityLabel={suggestion}
                  accessibilityHint="Selects this breed suggestion"
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
            accessibilityLabel="Save breed"
            accessibilityHint="Saves the breed details for this pet"
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Breed'}</Text>
          </TouchableOpacity>
        </View>

        {insights ? (
          <View style={styles.insightsCard}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Breed Insights
            </Text>
            <Text style={styles.insightText}>Breed: {insights.breedDisplay}</Text>
            <Text style={styles.insightText}>
              Estimated life expectancy: {insights.lifeExpectancyLabel}
            </Text>
            <Text style={[styles.subTitle, styles.marginTop]} accessibilityRole="header">
              Common health risks
            </Text>
            {insights.healthRisks.length > 0 ? (
              insights.healthRisks.map((risk) => (
                <Text key={risk} style={styles.bullet}>
                  • {risk}
                </Text>
              ))
            ) : (
              <Text style={styles.bullet}>• No breed-specific risks available.</Text>
            )}
            <Text style={[styles.subTitle, styles.marginTop]} accessibilityRole="header">
              Care recommendations
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA' },
  content: { padding: 16, paddingBottom: 32 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: { width: 64 },
  backText: { color: '#4CAF50', fontSize: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#1F2933' },
  photoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  photo: { width: 120, height: 120, borderRadius: 60 },
  photoPlaceholder: {
    backgroundColor: '#EEF2F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmoji: { fontSize: 40 },
  photoHint: { color: '#52606D', fontSize: 13, marginTop: 12, textAlign: 'center' },
  detectBtn: {
    marginTop: 12,
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  detectBtnText: { color: '#FFFFFF', fontWeight: '600' },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2933', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#D9E2EC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#1F2933',
  },
  suggestionsCard: { marginTop: 8 },
  suggestionChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#EEF2F5',
    borderRadius: 8,
    marginBottom: 6,
  },
  suggestionText: { color: '#1F2933' },
  saveBtn: {
    marginTop: 12,
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '600' },
  insightsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  insightText: { color: '#1F2933', marginBottom: 6 },
  subTitle: { fontSize: 14, fontWeight: '600', color: '#1F2933' },
  marginTop: { marginTop: 12 },
  bullet: { color: '#52606D', marginTop: 4 },
});

export default PetProfileScreen;
