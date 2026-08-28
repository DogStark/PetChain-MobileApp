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
  Share,
} from 'react-native';

import type { User, UserRole } from '../models/User';
import {
  backupToCloud,
  exportBackupJson,
  restoreBackupJson,
  restoreFromCloud,
} from '../services/backupService';
import {
  getPerformanceDashboard,
  recordMemorySample,
  recordScreenLoad,
  type PerformanceDashboard,
} from '../services/performanceService';
import { getReferralStats, type ReferralStats } from '../services/referralService';
import { getUserProfile, saveUserProfile, updateUserProfile } from '../services/userService';
import { formatAddress } from '../utils/localeValues';
import { useSecureScreen } from '../utils/secureScreen';

const DEFAULT_FORM: Omit<User, 'id'> = {
  email: '',
  name: '',
  phone: '',
  role: 'owner',
  profilePhoto: '',
  address: { street: '', city: '', state: '', postalCode: '', country: '' },
  emergencyContact: { name: '', phone: '', relationship: '', email: '' },
  notificationPreferences: {
    medicationReminders: true,
    appointmentReminders: true,
    vaccinationAlerts: true,
    reminderLeadTimeMinutes: 60,
    soundEnabled: true,
    badgeEnabled: true,
  },
};

const ProfileScreen: React.FC = () => {
  useSecureScreen();

  const [profile, setProfile] = useState<Omit<User, 'id'>>(DEFAULT_FORM);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [backupJson, setBackupJson] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [performance, setPerformance] = useState<PerformanceDashboard | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const loadStartedAt = useRef(Date.now());

  const reloadProfile = async () => {
    const stored = await getUserProfile();
    if (!stored) {
      return;
    }

    setExistingId(stored.id);
    setProfile({
      ...DEFAULT_FORM,
      ...stored,
      address: { ...DEFAULT_FORM.address, ...stored.address },
      emergencyContact: {
        ...DEFAULT_FORM.emergencyContact,
        ...stored.emergencyContact,
      },
      notificationPreferences: {
        ...DEFAULT_FORM.notificationPreferences,
        ...stored.notificationPreferences,
      },
    });
  };

  const reloadPerformance = async () => {
    setPerformance(await getPerformanceDashboard());
  };

  const reloadReferrals = async () => {
    try {
      setReferralStats(await getReferralStats());
    } catch {
      setReferralStats(null);
    }
  };

  useEffect(() => {
    void (async () => {
      await reloadProfile();
      await recordScreenLoad('Profile', Date.now() - loadStartedAt.current);
      await recordMemorySample('profile-screen');
      await reloadPerformance();
      await reloadReferrals();
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

  const handleExportBackup = async () => {
    setBackupBusy(true);
    try {
      const json = await exportBackupJson();
      setBackupJson(json);
      await Share.share({ message: json, title: 'PetChain backup' });
    } catch (error) {
      Alert.alert(
        'Backup failed',
        error instanceof Error ? error.message : 'Unable to export backup.',
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleCloudBackup = async () => {
    setBackupBusy(true);
    try {
      await backupToCloud();
      Alert.alert('Backup saved', 'Your cloud backup was updated.');
    } catch (error) {
      Alert.alert(
        'Backup failed',
        error instanceof Error ? error.message : 'Unable to save backup.',
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!backupJson.trim()) {
      Alert.alert('Restore backup', 'Paste a backup JSON first.');
      return;
    }

    setBackupBusy(true);
    try {
      await restoreBackupJson(backupJson.trim());
      await reloadProfile();
      await reloadPerformance();
      Alert.alert('Backup restored', 'Your local data has been restored.');
    } catch (error) {
      Alert.alert(
        'Restore failed',
        error instanceof Error ? error.message : 'Unable to restore backup.',
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreCloudBackup = async () => {
    setBackupBusy(true);
    try {
      await restoreFromCloud();
      await reloadProfile();
      await reloadPerformance();
      Alert.alert('Backup restored', 'Your cloud backup has been restored.');
    } catch (error) {
      Alert.alert(
        'Restore failed',
        error instanceof Error ? error.message : 'Unable to restore backup.',
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleShareReferralCode = async () => {
    if (!referralStats?.code) {
      Alert.alert('Referral code', 'Your referral code is not available right now.');
      return;
    }

    await Share.share({
      title: 'Join PetChain',
      message: `Use my PetChain referral code ${referralStats.code} and create your first pet record.`,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>User Profile</Text>

      <TextInput
        style={styles.input}
        placeholder="Full name"
        value={profile.name}
        onChangeText={(value) => setProfile((c) => ({ ...c, name: value }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        value={profile.email}
        onChangeText={(value) => setProfile((c) => ({ ...c, email: value }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Phone"
        keyboardType="phone-pad"
        value={profile.phone}
        onChangeText={(value) => setProfile((c) => ({ ...c, phone: value }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Role (owner, vet, admin)"
        value={profile.role}
        onChangeText={(value) => setProfile((c) => ({ ...c, role: value as UserRole }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Profile photo URL"
        value={profile.profilePhoto}
        onChangeText={(value) => setProfile((c) => ({ ...c, profilePhoto: value }))}
      />

      <Text style={styles.sectionTitle}>Address</Text>
      {(['street', 'city', 'state', 'postalCode', 'country'] as const).map((field) => (
        <TextInput
          key={field}
          style={styles.input}
          placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
          value={profile.address?.[field] ?? ''}
          onChangeText={(value) =>
            setProfile((c) => ({
              ...c,
              address: { ...c.address, [field]: value },
            }))
          }
        />
      ))}
      {profile.address && formatAddress(profile.address) ? (
        <Text style={styles.addressPreview}>{formatAddress(profile.address)}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Emergency Contact</Text>
      {(['name', 'phone', 'relationship', 'email'] as const).map((field) => (
        <TextInput
          key={field}
          style={styles.input}
          placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
          keyboardType={
            field === 'phone' ? 'phone-pad' : field === 'email' ? 'email-address' : 'default'
          }
          value={profile.emergencyContact?.[field] ?? ''}
          onChangeText={(value) =>
            setProfile((c) => ({
              ...c,
              emergencyContact: { ...c.emergencyContact, [field]: value },
            }))
          }
        />
      ))}

      <Text style={styles.sectionTitle}>Notification Preferences</Text>
      {(
        [
          'medicationReminders',
          'appointmentReminders',
          'vaccinationAlerts',
          'soundEnabled',
          'badgeEnabled',
        ] as const
      ).map((key) => (
        <View key={key} style={styles.switchRow}>
          <Text style={styles.switchLabel}>{key.replace(/([A-Z])/g, ' $1').trim()}</Text>
          <Switch
            value={(profile.notificationPreferences?.[key] as boolean) ?? true}
            onValueChange={(value) => setPref(key, value)}
          />
        </View>
      ))}
      <TextInput
        style={styles.input}
        placeholder="Reminder lead time (minutes)"
        keyboardType="numeric"
        value={String(profile.notificationPreferences?.reminderLeadTimeMinutes ?? 60)}
        onChangeText={(value) => setPref('reminderLeadTimeMinutes', Number(value) || 60)}
      />

      <TouchableOpacity style={styles.saveButton} onPress={save}>
        <Text style={styles.saveButtonText}>Save Profile</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Referrals & Credits</Text>
      <View style={styles.card}>
        <View style={styles.referralHeader}>
          <View>
            <Text style={styles.referralLabel}>Your referral code</Text>
            <Text style={styles.referralCode}>{referralStats?.code ?? 'Sign in to sync'}</Text>
          </View>
          <TouchableOpacity
            style={styles.smallButton}
            onPress={() => void handleShareReferralCode()}
          >
            <Text style={styles.smallButtonText}>Share</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.referralStatsRow}>
          <Text style={styles.dashboardText}>
            Converted: {referralStats?.successfulConversions ?? 0}
          </Text>
          <Text style={styles.dashboardText}>
            Pending: {referralStats?.pendingConversions ?? 0}
          </Text>
          <Text style={styles.dashboardText}>
            Credits: {referralStats?.availablePremiumDays ?? 0} days
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Backup & Performance</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => void handleExportBackup()}
          disabled={backupBusy}
        >
          <Text style={styles.actionButtonText}>Export Backup</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButtonSecondary}
          onPress={() => void handleCloudBackup()}
          disabled={backupBusy}
        >
          <Text style={styles.actionButtonText}>Cloud Backup</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButtonSecondary}
          onPress={() => void handleRestoreCloudBackup()}
          disabled={backupBusy}
        >
          <Text style={styles.actionButtonText}>Restore Cloud Backup</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.backupInput}
          placeholder="Paste backup JSON here"
          placeholderTextColor="#999"
          value={backupJson}
          onChangeText={setBackupJson}
          multiline
          numberOfLines={6}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={styles.actionButtonSecondary}
          onPress={() => void handleRestoreBackup()}
          disabled={backupBusy}
        >
          <Text style={styles.actionButtonText}>Restore Pasted Backup</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Performance Dashboard</Text>
        <Text style={styles.dashboardText}>
          Avg screen load: {performance?.averageScreenLoadMs ?? 0} ms
        </Text>
        <Text style={styles.dashboardText}>
          Avg API time: {performance?.averageApiTimingMs ?? 0} ms
        </Text>
        <Text style={styles.dashboardText}>
          Latest memory sample:{' '}
          {performance?.latestMemorySample?.bytes
            ? `${Math.round(performance.latestMemorySample.bytes / 1024)} KB`
            : 'n/a'}
        </Text>
        {performance?.topScreenLoads?.length ? (
          <View style={styles.metricList}>
            {performance.topScreenLoads.map((item) => (
              <Text key={`${item.screen}-${item.timestamp}`} style={styles.metricRow}>
                {item.screen}: {item.durationMs} ms
              </Text>
            ))}
          </View>
        ) : null}
        {performance?.topApiTimings?.length ? (
          <View style={styles.metricList}>
            {performance.topApiTimings.map((item) => (
              <Text key={`${item.endpoint}-${item.timestamp}`} style={styles.metricRow}>
                {item.method.toUpperCase()} {item.endpoint}: {item.durationMs} ms
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 18, paddingBottom: 36 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 20, color: '#111' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
    color: '#333',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 14,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
  },
  switchLabel: { fontSize: 14, color: '#333', flex: 1, marginRight: 8 },
  saveButton: {
    marginTop: 18,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  actionButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionButtonSecondary: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  backupInput: {
    minHeight: 120,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 13,
    color: '#111',
    textAlignVertical: 'top',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  dashboardText: { fontSize: 14, color: '#333', marginBottom: 8 },
  metricList: { marginTop: 8 },
  metricRow: { fontSize: 13, color: '#555', marginBottom: 6 },
  addressPreview: {
    fontSize: 13,
    color: '#4CAF50',
    marginBottom: 12,
    paddingHorizontal: 4,
    fontStyle: 'italic',
  },
  referralHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  referralLabel: { fontSize: 13, color: '#666', marginBottom: 4 },
  referralCode: { fontSize: 22, color: '#111', fontWeight: '800', letterSpacing: 0 },
  smallButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  smallButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  referralStatsRow: { marginTop: 12 },
});

export default ProfileScreen;
