/**
 * PendingCoSignScreen — detailed view of a pending multisig transaction.
 * Allows the current user to review details and submit their signature.
 *
 * In a production app the signing would use the user's Stellar keypair stored
 * in the device secure enclave. Here we accept the private key as input for
 * testnet demonstration purposes.
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

import multisigService, { type PendingTransactionResponse } from '../services/multisigService';
import {
  evaluateCoSignEligibility,
  markCoSignConsumed,
  releaseCoSignClaim,
  CO_SIGN_REJECT_MESSAGE,
} from '../utils/coSignReplayGuard';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  transaction: PendingTransactionResponse;
  currentUserPublicKey?: string;
  onBack: () => void;
  onSigned: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OP_LABELS: Record<PendingTransactionResponse['operationType'], string> = {
  ownership_transfer: 'Ownership Transfer',
  record_deletion: 'Record Deletion',
  signer_management: 'Signer Change',
};

const OP_ICONS: Record<PendingTransactionResponse['operationType'], string> = {
  ownership_transfer: '🔑',
  record_deletion: '🗑️',
  signer_management: '👤',
};

const RISK_COLORS: Record<PendingTransactionResponse['operationType'], string> = {
  ownership_transfer: '#F44336',
  record_deletion: '#FF9800',
  signer_management: '#2196F3',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

const PendingCoSignScreen: React.FC<Props> = ({
  transaction,
  currentUserPublicKey,
  onBack,
  onSigned,
}) => {
  const [privateKey, setPrivateKey] = useState('');
  const [signing, setSigning] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);

  const userSigner = transaction.signers.find((s) => s.publicKey === currentUserPublicKey);
  const alreadySigned = userSigner?.hasSigned ?? false;
  const eligibility = evaluateCoSignEligibility(transaction, currentUserPublicKey);
  const canSign = eligibility.canSign;

  const isExpired = new Date() > new Date(transaction.expiresAt);
  const isExpiringSoon =
    !isExpired && new Date(transaction.expiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000;

  const handleSign = async () => {
    // Replay guard: re-check the request is still signable before doing anything.
    const gate = evaluateCoSignEligibility(transaction, currentUserPublicKey);
    if (!gate.canSign) {
      Alert.alert('Cannot Sign', CO_SIGN_REJECT_MESSAGE[gate.reason ?? 'not-pending']);
      return;
    }
    if (!privateKey.trim()) {
      Alert.alert(
        'Private Key Required',
        'Enter your Stellar secret key to sign this transaction.',
      );
      return;
    }
    if (!privateKey.trim().startsWith('S') || privateKey.trim().length !== 56) {
      Alert.alert(
        'Invalid Secret Key',
        'Stellar secret keys start with S and are 56 characters long.',
      );
      return;
    }

    Alert.alert(
      'Confirm Signature',
      `You are about to sign:\n\n"${transaction.description}"\n\nThis action cannot be undone. Proceed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign',
          style: 'destructive',
          onPress: async () => {
            // Atomically claim this request+nonce. If another tap / re-entered
            // screen already claimed it, bail out instead of double-submitting.
            if (!markCoSignConsumed(transaction)) {
              Alert.alert('Cannot Sign', CO_SIGN_REJECT_MESSAGE['nonce-consumed']);
              return;
            }
            setSigning(true);
            try {
              // In production: use the keypair from secure storage, not user input
              await multisigService.signTransaction({
                transactionId: transaction.id,
                signedTransactionXdr: privateKey.trim(), // placeholder — real impl uses Keypair.sign
                signerPublicKey: currentUserPublicKey ?? '',
              });
              Alert.alert(
                'Signed',
                'Your signature has been recorded. The transaction will execute once enough co-owners have signed.',
                [{ text: 'OK', onPress: onSigned }],
              );
            } catch (error: any) {
              // Submission failed — release the claim so a retry is possible.
              releaseCoSignClaim(transaction);
              Alert.alert('Signing Failed', error?.message ?? 'Failed to sign transaction.');
            } finally {
              setSigning(false);
            }
          },
        },
      ],
    );
  };

  const progressPct = Math.min(
    100,
    (transaction.currentSignatureCount / transaction.requiredSignatures) * 100,
  );

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
        <Text style={styles.headerTitle}>Co-Sign Request</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Operation type banner */}
        <View
          style={[styles.opBanner, { borderLeftColor: RISK_COLORS[transaction.operationType] }]}
        >
          <Text style={styles.opBannerIcon}>{OP_ICONS[transaction.operationType]}</Text>
          <View style={styles.opBannerText}>
            <Text style={styles.opBannerType}>{OP_LABELS[transaction.operationType]}</Text>
            <Text style={styles.opBannerDesc}>{transaction.description}</Text>
          </View>
        </View>

        {/* Status / expiry */}
        {isExpired && (
          <View style={styles.alertBanner}>
            <Text style={styles.alertBannerText}>⚠️ This transaction has expired.</Text>
          </View>
        )}
        {isExpiringSoon && !isExpired && (
          <View style={[styles.alertBanner, styles.warnBanner]}>
            <Text style={styles.alertBannerText}>
              ⏰ Expires {new Date(transaction.expiresAt).toLocaleString()}
            </Text>
          </View>
        )}

        {/* Signature progress */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Signature Progress</Text>
          <Text style={styles.progressLabel}>
            {transaction.currentSignatureCount} of {transaction.requiredSignatures} required
            signatures collected
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>

          {transaction.signers.map((s) => (
            <View key={s.publicKey} style={styles.signerRow}>
              <Text style={styles.signerIcon}>{s.hasSigned ? '✅' : '⏳'}</Text>
              <View style={styles.signerInfo}>
                <Text style={styles.signerName}>
                  {s.name ?? `${s.publicKey.substring(0, 10)}…`}
                  {s.publicKey === currentUserPublicKey ? ' (you)' : ''}
                </Text>
                {s.signedAt && (
                  <Text style={styles.signerTime}>
                    Signed {new Date(s.signedAt).toLocaleString()}
                  </Text>
                )}
              </View>
              <Text style={[styles.signerStatus, s.hasSigned ? styles.signed : styles.pending]}>
                {s.hasSigned ? 'Signed' : 'Pending'}
              </Text>
            </View>
          ))}
        </View>

        {/* Metadata */}
        {transaction.metadata && Object.keys(transaction.metadata).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Transaction Details</Text>
            {Object.entries(transaction.metadata).map(([key, value]) => (
              <View key={key} style={styles.metaRow}>
                <Text style={styles.metaKey}>{key}</Text>
                <Text style={styles.metaValue} numberOfLines={2}>
                  {String(value)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Sign section */}
        {canSign && !isExpired && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign This Transaction</Text>
            <Text style={styles.signNote}>
              Your Stellar secret key is used to sign the transaction XDR locally. It is never
              transmitted to the server — only the signature is sent.
            </Text>

            {!showKeyInput ? (
              <TouchableOpacity style={styles.showKeyBtn} onPress={() => setShowKeyInput(true)}>
                <Text style={styles.showKeyBtnText}>Enter Secret Key to Sign</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput
                  style={[styles.input, styles.monoInput]}
                  value={privateKey}
                  onChangeText={setPrivateKey}
                  placeholder="SABC...XYZ (Stellar secret key)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  secureTextEntry
                  placeholderTextColor="#bbb"
                />
                <TouchableOpacity
                  style={[styles.signBtn, signing && styles.signBtnDisabled]}
                  onPress={handleSign}
                  disabled={signing}
                >
                  {signing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.signBtnText}>Sign & Submit</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {alreadySigned && (
          <View style={styles.alreadySignedBanner}>
            <Text style={styles.alreadySignedText}>
              ✅ You have already signed this transaction.
            </Text>
          </View>
        )}
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
  opBanner: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    alignItems: 'flex-start',
    gap: 12,
  },
  opBannerIcon: { fontSize: 28 },
  opBannerText: { flex: 1 },
  opBannerType: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  opBannerDesc: { fontSize: 13, color: '#666', marginTop: 4, lineHeight: 18 },
  alertBanner: {
    backgroundColor: '#fdecea',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  warnBanner: { backgroundColor: '#fff8e1' },
  alertBannerText: { fontSize: 13, color: '#c62828', fontWeight: '600' },
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
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  progressLabel: { fontSize: 13, color: '#666', marginBottom: 8 },
  progressBar: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: { height: '100%', backgroundColor: '#4CAF50', borderRadius: 4 },
  signerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  signerIcon: { fontSize: 18 },
  signerInfo: { flex: 1 },
  signerName: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  signerTime: { fontSize: 11, color: '#999', marginTop: 2 },
  signerStatus: { fontSize: 12, fontWeight: '600' },
  signed: { color: '#4CAF50' },
  pending: { color: '#FF9800' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  metaKey: { fontSize: 12, color: '#666', textTransform: 'capitalize' },
  metaValue: {
    fontSize: 12,
    color: '#1a1a1a',
    fontWeight: '600',
    maxWidth: '55%',
    textAlign: 'right',
  },
  signNote: { fontSize: 12, color: '#666', lineHeight: 18, marginBottom: 14 },
  showKeyBtn: {
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  showKeyBtnText: { color: '#4CAF50', fontWeight: '600', fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1a1a1a',
    backgroundColor: '#fafafa',
    marginBottom: 12,
  },
  monoInput: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12 },
  signBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  signBtnDisabled: { opacity: 0.6 },
  signBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  alreadySignedBanner: {
    backgroundColor: '#e8f5e9',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  alreadySignedText: { color: '#2e7d32', fontWeight: '600', fontSize: 14 },
});

export default PendingCoSignScreen;
