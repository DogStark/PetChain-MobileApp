import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import petService, { type Pet } from '../services/petService';
import { getPhoto, removePhoto, savePhoto } from '../utils/petPhotoStore';

interface Props {
  /** Pass a pet to edit; omit for add mode. */
  pet?: Pet;
  /** ownerId required when creating a new pet. */
  ownerId?: string;
  onBack: () => void;
  onSaved: (pet: Pet) => void;
}

interface FormState {
  name: string;
  species: string;
  breed: string;
  dateOfBirth: string;
  microchipId: string;
}

const EMPTY: FormState = { name: '', species: '', breed: '', dateOfBirth: '', microchipId: '' };

const PetFormScreen: React.FC<Props> = ({ pet, ownerId = '', onBack, onSaved }) => {
  const isEdit = !!pet;
  const [form, setForm] = useState<FormState>(
    pet
      ? {
          name: pet.name,
          species: pet.species,
          breed: pet.breed ?? '',
          dateOfBirth: pet.dateOfBirth?.slice(0, 10) ?? '',
          microchipId: pet.microchipId ?? '',
        }
      : EMPTY,
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inputRefs = {
    name: useRef<TextInput>(null),
    species: useRef<TextInput>(null),
    breed: useRef<TextInput>(null),
    dateOfBirth: useRef<TextInput>(null),
    microchipId: useRef<TextInput>(null),
  };

  const loadPhoto = useCallback(async () => {
    if (pet) setPhotoUri(await getPhoto(pet.id));
  }, [pet]);

  useEffect(() => {
    void loadPhoto();
  }, [loadPhoto]);

  const set = (key: keyof FormState) => (val: string) => setForm((f) => ({ ...f, [key]: val }));

  // ── Photo management ───────────────────────────────────────────────────────
  // Without expo-image-picker installed we prompt for a URI directly.
  // In a real build, replace this with ImagePicker.launchImageLibraryAsync().

  const handlePhotoAction = () => {
    Alert.alert('Pet Photo', 'Enter a photo URL or file URI', [
      {
        text: 'Enter URL',
        onPress: () => {
          Alert.prompt(
            'Photo URL',
            'Paste an image URL:',
            (url) => {
              if (url?.trim()) setPhotoUri(url.trim());
            },
            'plain-text',
          );
        },
      },
      photoUri
        ? {
            text: 'Remove Photo',
            style: 'destructive',
            onPress: () => setPhotoUri(null),
          }
        : { text: 'Cancel', style: 'cancel' },
      ...(!photoUri ? [{ text: 'Cancel', style: 'cancel' as const }] : []),
    ]);
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.name.trim() || !form.species.trim()) {
      Alert.alert('Validation', 'Name and species are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        species: form.species.trim(),
        breed: form.breed.trim() || undefined,
        dateOfBirth: form.dateOfBirth.trim() || undefined,
        microchipId: form.microchipId.trim() || undefined,
      };

      let saved: Pet;
      if (isEdit && pet) {
        saved = await petService.updatePet(pet.id, payload);
      } else {
        saved = await petService.createPet({ ...payload, ownerId });
      }

      // Persist photo locally
      if (photoUri) {
        await savePhoto(saved.id, photoUri);
      } else if (isEdit && pet) {
        await removePhoto(pet.id);
      }

      onSaved(saved);
    } catch {
      Alert.alert('Error', 'Failed to save pet. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const fields: {
    key: keyof FormState;
    label: string;
    placeholder: string;
    next?: keyof FormState;
    returnKeyType: 'next' | 'done';
  }[] = [
    {
      key: 'name',
      label: 'Name *',
      placeholder: 'e.g. Buddy',
      next: 'species',
      returnKeyType: 'next',
    },
    {
      key: 'species',
      label: 'Species *',
      placeholder: 'e.g. Dog, Cat',
      next: 'breed',
      returnKeyType: 'next',
    },
    {
      key: 'breed',
      label: 'Breed',
      placeholder: 'e.g. Labrador',
      next: 'dateOfBirth',
      returnKeyType: 'next',
    },
    {
      key: 'dateOfBirth',
      label: 'Date of Birth',
      placeholder: 'YYYY-MM-DD',
      next: 'microchipId',
      returnKeyType: 'next',
    },
    { key: 'microchipId', label: 'Microchip ID', placeholder: 'Optional', returnKeyType: 'done' },
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Edit Pet' : 'Add Pet'}</Text>
        <TouchableOpacity
          onPress={() => void handleSave()}
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Photo */}
        <TouchableOpacity style={styles.photoSection} onPress={handlePhotoAction}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Text style={styles.photoEmoji}>🐾</Text>
            </View>
          )}
          <Text style={styles.photoHint}>{photoUri ? 'Change photo' : 'Add photo'}</Text>
        </TouchableOpacity>

        {/* Fields */}
        <View style={styles.formCard}>
          {fields.map(({ key, label, placeholder, next, returnKeyType }) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{label}</Text>
              <TextInput
                ref={inputRefs[key]}
                style={styles.input}
                placeholder={placeholder}
                value={form[key]}
                onChangeText={set(key)}
                placeholderTextColor="#bbb"
                returnKeyType={returnKeyType}
                onSubmitEditing={() => {
                  if (next) {
                    inputRefs[next].current?.focus();
                  } else {
                    void handleSave();
                  }
                }}
                blurOnSubmit={!next}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  saveBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '600' },
  content: { padding: 16 },
  photoSection: { alignItems: 'center', marginBottom: 20 },
  photo: { width: 100, height: 100, borderRadius: 50, marginBottom: 8 },
  photoPlaceholder: { backgroundColor: '#e8f5e9', justifyContent: 'center', alignItems: 'center' },
  photoEmoji: { fontSize: 40 },
  photoHint: { fontSize: 13, color: '#4CAF50', fontWeight: '600' },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  fieldRow: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, color: '#666', marginBottom: 4, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fafafa',
    color: '#1a1a1a',
  },
});

export default PetFormScreen;
