import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  confirmExportDownloaded,
  requestPortabilityExport,
  type PortabilityExport,
} from '../services/complianceService';
import { deleteAccount, getUserProfile } from '../services/userService';

interface Props {
  onBack: () => void;
  onDeleted: () => void;
}

const CONFIRM_WORD = 'DELETE';

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const DeleteAccountScreen: React.FC<Props> = ({ onBack, onDeleted }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<PortabilityExport | null>(null);
  const [exportDownloaded, setExportDownloaded] = useState(false);

  const confirmed = input.trim() === CONFIRM_WORD;

  const handleExport = async () => {
    setExporting(true);
    try {
      const profile = await getUserProfile();
      if (!profile?.id) {
        throw new Error('No profile available');
      }
      const result = await requestPortabilityExport(profile.id);
      setExportInfo(result);
      await Linking.openURL(result.downloadUrl);
      await confirmExportDownloaded(profile.id);
      setExportDownloaded(true);
    } catch {
      Alert.alert('Export failed', 'Could not generate your data export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Final Confirmation',
      'This will permanently delete your account, all pets, medical records, medications, and appointments. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await deleteAccount();
              onDeleted();
            } catch {
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Delete Account</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.warningCard}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <Text style={styles.warningTitle}>This action is irreversible</Text>
          <Text style={styles.warningBody}>Deleting your account will permanently remove:</Text>
          {[
            'Your profile and personal data',
            'All pets and their profiles',
            'All medical records',
            'All medications and schedules',
            'All appointments',
            'All notification preferences',
          ].map((item) => (
            <Text key={item} style={styles.bulletItem}>
              • {item}
            </Text>
          ))}
        </View>

        <View style={styles.exportCard}>
          <Text style={styles.exportTitle}>1. Download your data</Text>
          <Text style={styles.exportBody}>
            Before deleting, download a copy of your profile, pets, medical records, medications and
            appointments. The download link is signed and stays valid for 48 hours.
          </Text>
          <TouchableOpacity
            style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
            onPress={() => void handleExport()}
            disabled={exporting}
            accessibilityRole="button"
            accessibilityLabel="Download my data export"
          >
            {exporting ? (
              <ActivityIndicator color="#2d3748" />
            ) : (
              <Text style={styles.exportBtnText}>
                {exportInfo ? 'Download Export Again' : 'Download My Data'}
              </Text>
            )}
          </TouchableOpacity>
          {exportInfo && (
            <Text style={styles.exportMeta}>
              Link expires {formatDateTime(exportInfo.expiresAt)}
            </Text>
          )}
          {exportDownloaded && (
            <Text style={styles.exportMeta}>
              Export downloaded. Deletion can only run after a 24-hour cooling-off period.
            </Text>
          )}
        </View>

        <View style={styles.confirmCard}>
          <Text style={styles.confirmLabel}>
            Type <Text style={styles.confirmWord}>{CONFIRM_WORD}</Text> to confirm
          </Text>
          <TextInput
            style={[styles.input, confirmed && styles.inputConfirmed]}
            value={input}
            onChangeText={setInput}
            placeholder={CONFIRM_WORD}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Type DELETE to confirm account deletion"
          />
          {!exportDownloaded && (
            <Text style={styles.exportHint}>
              Download your data export first to enable deletion.
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.deleteBtn,
            (!confirmed || loading || !exportDownloaded) && styles.deleteBtnDisabled,
          ]}
          onPress={handleDelete}
          disabled={!confirmed || loading || !exportDownloaded}
          accessibilityRole="button"
          accessibilityLabel="Delete account permanently"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.deleteBtnText}>Delete My Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 12,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  content: { padding: 16, gap: 16 },
  warningCard: {
    backgroundColor: '#fff3f3',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ffcdd2',
    gap: 6,
  },
  warningIcon: { fontSize: 28, textAlign: 'center', marginBottom: 4 },
  warningTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#c62828',
    textAlign: 'center',
    marginBottom: 4,
  },
  warningBody: { fontSize: 14, color: '#555', marginBottom: 4 },
  bulletItem: { fontSize: 13, color: '#666', paddingLeft: 4 },
  confirmCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    gap: 10,
  },
  confirmLabel: { fontSize: 14, color: '#555' },
  confirmWord: { fontWeight: '700', color: '#c62828' },
  exportCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    gap: 10,
  },
  exportTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  exportBody: { fontSize: 13, color: '#555', lineHeight: 19 },
  exportBtn: {
    backgroundColor: '#edf2f7',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText: { color: '#2d3748', fontWeight: '600', fontSize: 15 },
  exportMeta: { fontSize: 12, color: '#666' },
  exportHint: { fontSize: 12, color: '#b26a00', fontWeight: '600' },
  input: {
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    letterSpacing: 2,
    backgroundColor: '#fafafa',
  },
  inputConfirmed: { borderColor: '#c62828', backgroundColor: '#fff3f3' },
  deleteBtn: {
    backgroundColor: '#c62828',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  cancelBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },
});

export default DeleteAccountScreen;
