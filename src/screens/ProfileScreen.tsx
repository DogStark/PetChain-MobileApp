import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type { User, UserRole } from '../models/User';
import { getUserProfile, saveUserProfile, updateUserProfile } from '../services/userService';
import { scale, scaleFont } from '../utils/scaling';

const DEFAULT_FORM: Omit<User, 'id'> = {
  email: '',
  name: '',
  phone: '',
  role: 'owner',
  profilePhoto: '',
  address: {
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  },
  emergencyContact: {
    name: '',
    phone: '',
    relationship: '',
    email: '',
  },
  notificationPreferences: {
    medicationReminders: true,
    appointmentReminders: true,
    vaccinationAlerts: true,
    reminderLeadTimeMinutes: 60,
    soundEnabled: true,
    badgeEnabled: true,
  },
  accessibilityPreferences: {
    largeTextEnabled: false,
    fontScaleMultiplier: 1.0,
  },
};

const ProfileScreen: React.FC = () => {
  const [profile, setProfile] = useState<Omit<User, 'id'>>(DEFAULT_FORM);
  const [existingId, setExistingId] = useState<string | null>(null);

  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const roleRef = useRef<TextInput>(null);
  const photoRef = useRef<TextInput>(null);
  const streetRef = useRef<TextInput>(null);
  const cityRef = useRef<TextInput>(null);
  const stateRef = useRef<TextInput>(null);
  const postalRef = useRef<TextInput>(null);
  const countryRef = useRef<TextInput>(null);
  const ecNameRef = useRef<TextInput>(null);
  const ecPhoneRef = useRef<TextInput>(null);
  const ecRelRef = useRef<TextInput>(null);
  const ecEmailRef = useRef<TextInput>(null);
  const leadTimeRef = useRef<TextInput>(null);

  useEffect(() => {
    void (async () => {
      const stored = await getUserProfile();
      if (stored) {
        setExistingId(stored.id);
        setProfile({
          ...DEFAULT_FORM,
          ...stored,
          address: { ...DEFAULT_FORM.address, ...stored.address },
          emergencyContact: { ...DEFAULT_FORM.emergencyContact, ...stored.emergencyContact },
          notificationPreferences: {
            ...DEFAULT_FORM.notificationPreferences,
            ...stored.notificationPreferences,
          },
          accessibilityPreferences: {
            ...DEFAULT_FORM.accessibilityPreferences,
            ...stored.accessibilityPreferences,
          },
        });
      }
    })();
  }, []);

  const save = async () => {
    if (!profile.email.trim() || !profile.name.trim()) {
      Alert.alert('Validation', 'Name and email are required.');
      return;
    }

    try {
      const payload: User = {
        id: existingId ?? `user_${Date.now()}`,
        ...profile,
      };

      if (existingId) {
        await updateUserProfile(payload);
      } else {
        await saveUserProfile(payload);
        setExistingId(payload.id);
      }

      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (error) {
      Alert.alert(
        'Save failed',
        error instanceof Error ? error.message : 'Unable to save profile.',
      );
    }
  };

  const setPref = (
    key: keyof NonNullable<User['notificationPreferences']>,
    value: boolean | number,
  ) => {
    setProfile((current) => ({
      ...current,
      notificationPreferences: {
        ...current.notificationPreferences,
        [key]: value,
      },
    }));
  };

  const setAccessibilityPref = (
    key: keyof NonNullable<User['accessibilityPreferences']>,
    value: boolean | number,
  ) => {
    setProfile((current) => ({
      ...current,
      accessibilityPreferences: {
        ...current.accessibilityPreferences,
        [key]: value,
      },
    }));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>User Profile</Text>

      <TextInput
        style={styles.input}
        placeholder="Full name"
        value={profile.name}
        onChangeText={(value) => setProfile((current) => ({ ...current, name: value }))}
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={emailRef}
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        value={profile.email}
        onChangeText={(value) => setProfile((current) => ({ ...current, email: value }))}
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={phoneRef}
        style={styles.input}
        placeholder="Phone"
        keyboardType="phone-pad"
        value={profile.phone}
        onChangeText={(value) => setProfile((current) => ({ ...current, phone: value }))}
        returnKeyType="next"
        onSubmitEditing={() => roleRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={roleRef}
        style={styles.input}
        placeholder="Role (owner, vet, admin)"
        value={profile.role}
        onChangeText={(value) => setProfile((current) => ({ ...current, role: value as UserRole }))}
        returnKeyType="next"
        onSubmitEditing={() => photoRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={photoRef}
        style={styles.input}
        placeholder="Profile photo URL"
        value={profile.profilePhoto}
        onChangeText={(value) => setProfile((current) => ({ ...current, profilePhoto: value }))}
        returnKeyType="next"
        onSubmitEditing={() => streetRef.current?.focus()}
        blurOnSubmit={false}
      />

      <Text style={styles.sectionTitle}>Address</Text>
      <TextInput
        ref={streetRef}
        style={styles.input}
        placeholder="Street"
        value={profile.address?.street ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            address: { ...current.address, street: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => cityRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={cityRef}
        style={styles.input}
        placeholder="City"
        value={profile.address?.city ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            address: { ...current.address, city: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => stateRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={stateRef}
        style={styles.input}
        placeholder="State"
        value={profile.address?.state ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            address: { ...current.address, state: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => postalRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={postalRef}
        style={styles.input}
        placeholder="Postal code"
        value={profile.address?.postalCode ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            address: { ...current.address, postalCode: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => countryRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={countryRef}
        style={styles.input}
        placeholder="Country"
        value={profile.address?.country ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            address: { ...current.address, country: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => ecNameRef.current?.focus()}
        blurOnSubmit={false}
      />

      <Text style={styles.sectionTitle}>Emergency Contact</Text>
      <TextInput
        ref={ecNameRef}
        style={styles.input}
        placeholder="Name"
        value={profile.emergencyContact?.name ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            emergencyContact: { ...current.emergencyContact, name: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => ecPhoneRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={ecPhoneRef}
        style={styles.input}
        placeholder="Phone"
        keyboardType="phone-pad"
        value={profile.emergencyContact?.phone ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            emergencyContact: { ...current.emergencyContact, phone: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => ecRelRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={ecRelRef}
        style={styles.input}
        placeholder="Relationship"
        value={profile.emergencyContact?.relationship ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            emergencyContact: { ...current.emergencyContact, relationship: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => ecEmailRef.current?.focus()}
        blurOnSubmit={false}
      />
      <TextInput
        ref={ecEmailRef}
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        value={profile.emergencyContact?.email ?? ''}
        onChangeText={(value) =>
          setProfile((current) => ({
            ...current,
            emergencyContact: { ...current.emergencyContact, email: value },
          }))
        }
        returnKeyType="next"
        onSubmitEditing={() => leadTimeRef.current?.focus()}
        blurOnSubmit={false}
      />

      <Text style={styles.sectionTitle}>Notification Preferences</Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Medication reminders</Text>
        <Switch
          value={profile.notificationPreferences?.medicationReminders ?? true}
          onValueChange={(value) => setPref('medicationReminders', value)}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Appointment reminders</Text>
        <Switch
          value={profile.notificationPreferences?.appointmentReminders ?? true}
          onValueChange={(value) => setPref('appointmentReminders', value)}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Vaccination alerts</Text>
        <Switch
          value={profile.notificationPreferences?.vaccinationAlerts ?? true}
          onValueChange={(value) => setPref('vaccinationAlerts', value)}
        />
      </View>
      <TextInput
        ref={leadTimeRef}
        style={styles.input}
        placeholder="Reminder lead time (minutes)"
        keyboardType="numeric"
        value={String(profile.notificationPreferences?.reminderLeadTimeMinutes ?? 60)}
        onChangeText={(value) => setPref('reminderLeadTimeMinutes', Number(value) || 60)}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Sound enabled</Text>
        <Switch
          value={profile.notificationPreferences?.soundEnabled ?? true}
          onValueChange={(value) => setPref('soundEnabled', value)}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Badge enabled</Text>
        <Switch
          value={profile.notificationPreferences?.badgeEnabled ?? true}
          onValueChange={(value) => setPref('badgeEnabled', value)}
        />
      </View>

      <Text style={styles.sectionTitle}>Accessibility</Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Enable large text</Text>
        <Switch
          value={profile.accessibilityPreferences?.largeTextEnabled ?? false}
          onValueChange={(value) => setAccessibilityPref('largeTextEnabled', value)}
        />
      </View>
      <TextInput
        style={styles.input}
        placeholder="Font scale multiplier (e.g. 1.2)"
        keyboardType="numeric"
        value={String(profile.accessibilityPreferences?.fontScaleMultiplier ?? 1.0)}
        onChangeText={(value) => setAccessibilityPref('fontScaleMultiplier', Number(value) || 1.0)}
        returnKeyType="done"
      />

      <TouchableOpacity style={styles.saveButton} onPress={save}>
        <Text style={styles.saveButtonText}>Save Profile</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: scale(18), paddingBottom: scale(36) },
  heading: { fontSize: scaleFont(22), fontWeight: '700', marginBottom: scale(20), color: '#111' },
  sectionTitle: {
    fontSize: scaleFont(16),
    fontWeight: '700',
    marginTop: scale(18),
    marginBottom: scale(10),
    color: '#333',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: scale(10),
    paddingHorizontal: scale(14),
    paddingVertical: scale(12),
    marginBottom: scale(12),
    fontSize: scaleFont(14),
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: scale(12),
    paddingVertical: scale(6),
    paddingHorizontal: scale(8),
    backgroundColor: '#fff',
    borderRadius: scale(10),
    borderWidth: 1,
    borderColor: '#eee',
  },
  switchLabel: { fontSize: scaleFont(14), color: '#333', flex: 1, marginRight: scale(8) },
  saveButton: {
    marginTop: scale(18),
    backgroundColor: '#4CAF50',
    borderRadius: scale(10),
    paddingVertical: scale(14),
    alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: scaleFont(15) },
});

export default ProfileScreen;
