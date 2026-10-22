/**
 * CoOwnerInviteScreen — invite a new co-owner to a jointly-owned pet.
 * Collects the invitee's email, Stellar public key, and signing weight.
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

import multisigService, { notifyCoSignRequest } from '../services/multisigService';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  petId: string;
  petName: string;
  jointOwnershipId: string;
  totalWeight: number;
  onBack: () => void;
  onInviteSent: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const CoOwnerInviteScreen: React.FC<Props> = ({
  petId,
  petName,
  jointOwnershipId,
  totalWeight,
  onBack,
  onInviteSent,
}) => {
  const [email, setEmail] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [weight, setWeight] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  const isValidStellarKey = (key: string) => /^G[A-Z2-7]{55}$/.test(key.trim());

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    const trimmedKey = publicKey.trim();
    const parsedWeight = parseInt(weight, 10);

    if (!isValidEmail(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!isValidStellarKey(trimmedKey)) {
      Alert.alert(
        'Invalid Public Key',
        'Please enter a valid Stellar public key (starts with G, 56 characters).',
      );
      return;
    }
    if (isNaN(parsedWeight) || parsedWeight < 1 || parsedWeight > totalWeight) {
      Alert.alert('Invalid Weight', `Weight must be between 1 and ${totalWeight}.`);
      return;
    }

    setSubmitting(true);
    try {
      await multisigService.inviteCoOwner({
        petId,
        jointOwnershipId,
        invitedEmail: trimmedEmail,
        weight: parsedWeight,
      });

      await notifyCoSignRequest(
        'signer_management',
        `You've been invited to co-own ${petName}. Accept the invite to become a co-signer.`,
        jointOwnershipId,
      );

      Alert.alert(
        'Invite Sent',
        `An invitation has been sent to ${trimmedEmail}. They'll need to accept before becoming an active co-owner.`,
        [{ text: 'OK', onPress: onInviteSent }],
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Failed to send invite. Please try again.');
    } finally {
      setSubmitting(false);
    }
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
        <Text style={styles.headerTitle}>Invite Co-Owner</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Info banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerIcon}>🤝</Text>
          <Text style={styles.infoBannerText}>
            Inviting a co-owner for <Text style={styles.bold}>{petName}</Text>. They will be added
            as a Stellar signer on the multisig account and must co-sign critical operations.
          </Text>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <Text style={styles.label}>Co-owner Email *</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="co-owner@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor="#bbb"
          />

          <Text style={styles.label}>Stellar Public Key *</Text>
          <TextInput
            style={[styles.input, styles.monoInput]}
            value={publicKey}
            onChangeText={setPublicKey}
            placeholder="GABC...XYZ (56 characters)"
            autoCapitalize="characters"
            autoCorrect={false}
            placeholderTextColor="#bbb"
          />
          {publicKey.length > 0 && !isValidStellarKey(publicKey) && (
            <Text style={styles.fieldError}>
              Must start with G and be 56 characters (Stellar Ed25519 key)
            </Text>
          )}

          <Text style={styles.label}>Signing Weight *</Text>
          <TextInput
            style={styles.input}
            value={weight}
            onChangeText={setWeight}
            placeholder="1"
            keyboardType="number-pad"
            placeholderTextColor="#bbb"
          />
          <Text style={styles.hint}>
            Weight determines voting power. Current total weight: {totalWeight}. Higher weight =
            more influence on M-of-N threshold.
          </Text>
        </View>

        {/* M-of-N explanation */}
        <View style={styles.explainCard}>
          <Text style={styles.explainTitle}>How M-of-N Signing Works</Text>
          <Text style={styles.explainText}>
            • <Text style={styles.bold}>Ownership transfers</Text> and{' '}
            <Text style={styles.bold}>record deletions</Text> require the high threshold — all
            co-owners must agree.{'\n'}• <Text style={styles.bold}>Adding/removing signers</Text>{' '}
            requires the medium threshold.{'\n'}• Each co-owner signs with their Stellar keypair.
            Once enough weight accumulates, the transaction is submitted to the Stellar testnet.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Send Invite</Text>
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
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: '#e8f5e9',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    alignItems: 'flex-start',
    gap: 10,
  },
  infoBannerIcon: { fontSize: 22 },
  infoBannerText: { flex: 1, fontSize: 13, color: '#2e7d32', lineHeight: 18 },
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
  fieldError: { fontSize: 11, color: '#F44336', marginTop: 4 },
  hint: { fontSize: 11, color: '#999', marginTop: 6, lineHeight: 16 },
  explainCard: {
    backgroundColor: '#fff8e1',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ffe082',
  },
  explainTitle: { fontSize: 13, fontWeight: '700', color: '#f57f17', marginBottom: 8 },
  explainText: { fontSize: 12, color: '#795548', lineHeight: 18 },
  submitBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

export default CoOwnerInviteScreen;
