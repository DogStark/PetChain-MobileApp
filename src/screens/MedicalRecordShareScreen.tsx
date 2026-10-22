import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  exportRecordAsPdf,
  generateShareableLink,
  nativeShare,
  shareRecordWithVet,
} from '../services/medicalRecordSharingService';

interface Props {
  petId: string;
  recordId: string;
  onBack: () => void;
}

type LoadingAction = 'link' | 'pdf' | 'vet' | null;

const MedicalRecordShareScreen: React.FC<Props> = ({ petId, recordId, onBack }) => {
  const [loading, setLoading] = useState<LoadingAction>(null);
  const [vetId, setVetId] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  const handleGenerateLink = async () => {
    setLoading('link');
    try {
      const { url, expiresAt } = await generateShareableLink(petId, recordId);
      setGeneratedLink(url);
      const expiry = new Date(expiresAt).toLocaleString();
      await nativeShare(url, `Medical record (expires ${expiry}):`);
    } catch {
      Alert.alert('Error', 'Failed to generate shareable link.');
    } finally {
      setLoading(null);
    }
  };

  const handleExportPdf = async () => {
    setLoading('pdf');
    try {
      const { downloadUrl, filename } = await exportRecordAsPdf(petId, recordId);
      await nativeShare(downloadUrl, `Medical record PDF: ${filename}`);
    } catch {
      Alert.alert('Error', 'Failed to export record as PDF.');
    } finally {
      setLoading(null);
    }
  };

  const handleShareWithVet = async () => {
    if (!vetId.trim()) {
      Alert.alert('Required', 'Please enter a Vet ID.');
      return;
    }
    setLoading('vet');
    try {
      await shareRecordWithVet(petId, recordId, vetId.trim());
      Alert.alert('Sent', 'Record shared with vet successfully.');
      setVetId('');
    } catch {
      Alert.alert('Error', 'Failed to share record with vet.');
    } finally {
      setLoading(null);
    }
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
        <Text style={styles.title}>Share Record</Text>
      </View>

      <View style={styles.content}>
        {/* Secure Link */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔗 Shareable Link</Text>
          <Text style={styles.cardDesc}>Generate a time-limited secure link anyone can open.</Text>
          {generatedLink ? (
            <Text style={styles.linkText} numberOfLines={2} accessibilityLabel="Generated link">
              {generatedLink}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.btn, loading === 'link' && styles.btnDisabled]}
            onPress={handleGenerateLink}
            disabled={loading !== null}
            accessibilityRole="button"
            accessibilityLabel="Generate and share secure link"
          >
            {loading === 'link' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Generate & Share</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* PDF Export */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📄 Export as PDF</Text>
          <Text style={styles.cardDesc}>Download a PDF copy and share via any app.</Text>
          <TouchableOpacity
            style={[styles.btn, loading === 'pdf' && styles.btnDisabled]}
            onPress={handleExportPdf}
            disabled={loading !== null}
            accessibilityRole="button"
            accessibilityLabel="Export record as PDF"
          >
            {loading === 'pdf' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Export PDF</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Direct Vet Share */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🩺 Share with Vet</Text>
          <Text style={styles.cardDesc}>Send directly to a vet using their Vet ID.</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Vet ID"
            value={vetId}
            onChangeText={setVetId}
            autoCapitalize="none"
            accessibilityLabel="Vet ID input"
          />
          <TouchableOpacity
            style={[styles.btn, loading === 'vet' && styles.btnDisabled]}
            onPress={handleShareWithVet}
            disabled={loading !== null}
            accessibilityRole="button"
            accessibilityLabel="Share record with vet"
          >
            {loading === 'vet' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Send to Vet</Text>
            )}
          </TouchableOpacity>
        </View>
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
  content: { padding: 16, gap: 14 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  cardDesc: { fontSize: 13, color: '#666' },
  linkText: {
    fontSize: 12,
    color: '#4CAF50',
    backgroundColor: '#e8f5e9',
    padding: 8,
    borderRadius: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fafafa',
  },
  btn: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});

export default MedicalRecordShareScreen;
