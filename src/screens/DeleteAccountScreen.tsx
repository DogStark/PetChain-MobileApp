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

import { deleteAccount } from '../services/userService';

interface Props {
  onBack: () => void;
  onDeleted: () => void;
}

const CONFIRM_WORD = 'DELETE';

const DeleteAccountScreen: React.FC<Props> = ({ onBack, onDeleted }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const confirmed = input.trim() === CONFIRM_WORD;

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
        </View>

        <TouchableOpacity
          style={[styles.deleteBtn, (!confirmed || loading) && styles.deleteBtnDisabled]}
          onPress={handleDelete}
          disabled={!confirmed || loading}
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
