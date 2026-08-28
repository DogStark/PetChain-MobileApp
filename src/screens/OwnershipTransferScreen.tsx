/**
 * OwnershipTransferScreen — initiate a multisig ownership transfer for a jointly-owned pet.
 * Creates a pending transaction that all co-owners must sign before it executes on Stellar.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import multisigService from '../services/multisigService';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  petId: string;
  petName: string;
  jointOwnershipId: string;
  requiredWeight: number;
  totalWeight: number;
  onBack: () => void;
  onTransferInitiated: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const OwnershipTransferScreen: React.FC<Props> = ({
  petId,
  petName,
  jointOwnershipId,
  requiredWeight,
  totalWeight,
  onBack,
  onTransferInitiated,
}) => {
  const [newOwnerPublicKey, setNewOwnerPublicKey] = useState('');
  const [newOwnerUserId, setNewOwnerUserId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isValidStellarKey = (key: string) => /^G[A-Z2-7]{55}$/.test(key.trim());

  const handleSubmit = async () => {
    const trimmedKey = newOwnerPublicKey.trim();
    if (!isValidStellarKey(trimmedKey)) {
      Alert.alert(
        'Invalid Public Key',
        'Enter a valid Stellar public key (starts with G, 56 chars).',
      );
      return;
    }
    if (!newOwnerUserId.trim()) {
      Alert.alert('New Owner ID Required', 'Enter the user ID of the new owner.');
      return;
    }

    Alert.alert(
      'Confirm Transfer Request',
      `This will create a pending ownership transfer for ${petName}.\n\nAll co-owners (${requiredWeight}/${totalWeight} weight) must sign before the transfer executes on Stellar.\n\nProceed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create Request',
          onPress: async () => {
            setSubmitting(true);
            try {
              const tx = await multisigService.initiateOwnershipTransfer({
                petId,
                jointOwnershipId,
                newOwnerPublicKey: trimmedKey,
                newOwnerUserId: newOwnerUserId.trim(),
                reason: reason.trim() || undefined,
              });

              await multisigService.notifyCoSignRequest(
                'ownership_transfer',
                `Ownership transfer for ${petName} requires your signature.`,
                tx.id,
              );

              Alert.alert(
                'Transfer Requested',
                `A co-sign request has been sent to all ${petName} co-owners. The transfer will execute once ${requiredWeight}/${totalWeight} weight in signatures is collected.`,
                [{ text: 'OK', onPress: onTransferInitiated }],
              );
            } catch (error: any) {
              Alert.alert('Error', error?.message ?? 'Failed to initiate transfer.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transfer Ownership</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Warning banner */}
        <View style={styles.warningBanner}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <View style={styles.warningText}>
            <Text style={styles.warningTitle}>Critical Operation</Text>
            <Text style={styles.warningBody}>
              Transferring ownership of <Text style={styles.bold}>{petName}</Text> is irreversible
              once all co-owners sign. This requires{' '}
              <Text style={styles.bold}>
                {requiredWeight}/{totalWeight}
              </Text>{' '}
              weight in signatures.
            </Text>
          </View>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <Text style={styles.label}>New Owner's Stellar Public Key *</Text>
          <TextInput
            style={[styles.input, styles.monoInput]}
            value={newOwnerPublicKey}
            onChangeText={setNewOwnerPublicKey}
            placeholder="GABC...XYZ"
            autoCapitalize="characters"
            autoCorrect={false}
            placeholderTextColor="#bbb"
          />
          {newOwnerPublicKey.length > 0 && !isValidStellarKey(newOwnerPublicKey) && (
            <Text style={styles.fieldError}>Must start with G and be 56 characters</Text>
          )}

          <Text style={styles.label}>New Owner's User ID *</Text>
          <TextInput
            style={styles.input}
            value={newOwnerUserId}
            onChangeText={setNewOwnerUserId}
            placeholder="user-id-123"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor="#bbb"
          />

          <Text style={styles.label}>Reason (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Rehoming, sale, gift..."
            multiline
            numberOfLines={3}
            placeholderTextColor="#bbb"
          />
        </View>

        {/* Process explanation */}
        <View style={styles.processCard}>
          <Text style={styles.processTitle}>What happens next</Text>
          <View style={styles.processStep}>
            <Text style={styles.processNum}>1</Text>
            <Text style={styles.processText}>
              A pending transaction is created on the Stellar testnet
            </Text>
          </View>
          <View style={styles.processStep}>
            <Text style={styles.processNum}>2</Text>
            <Text style={styles.processText}>
              All co-owners receive a push notification to co-sign
            </Text>
          </View>
          <View style={styles.processStep}>
            <Text style={styles.processNum}>3</Text>
            <Text style={styles.processText}>
              Once {requiredWeight}/{totalWeight} weight is collected, the transaction is submitted
            </Text>
          </View>
          <View style={styles.processStep}>
            <Text style={styles.processNum}>4</Text>
            <Text style={styles.processText}>
              Ownership is transferred on-chain and the pet record is updated
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Initiate Transfer Request</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  headerRight: { width: 60 },
  content: { padding: 16, paddingBottom: 40 },
  warningBanner: {
    flexDirection: 'row',
    backgroundColor: '#fdecea',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ffcdd2',
    gap: 10,
    alignItems: 'flex-start',
  },
  warningIcon: { fontSize: 22 },
  warningText: { flex: 1 },
  warningTitle: { fontSize: 14, fontWeight: '700', color: '#c62828', marginBottom: 4 },
  warningBody: { fontSize: 13, color: '#b71c1c', lineHeight: 18 },
  bold: { fontWeight: '700' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1a1a1a',
    backgroundColor: '#fafafa',
  },
  monoInput: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12 },
  textArea: { height: 80, textAlignVertical: 'top' },
  fieldError: { fontSize: 11, color: '#F44336', marginTop: 4 },
  processCard: {
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#bbdefb',
  },
  processTitle: { fontSize: 13, fontWeight: '700', color: '#1565c0', marginBottom: 10 },
  processStep: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 10 },
  processNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1565c0',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12,
    fontWeight: '700',
  },
  processText: { flex: 1, fontSize: 12, color: '#0d47a1', lineHeight: 18 },
  submitBtn: {
    backgroundColor: '#F44336',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

export default OwnershipTransferScreen;
