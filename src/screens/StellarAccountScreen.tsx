import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import config from '../config';
import logger from '../services/loggerService';
import { getQRImageUrl } from '../services/qrCodeService';
import stellarService from '../services/stellarAccountService';

const StellarAccountScreen: React.FC = () => {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [importSecretText, setImportSecretText] = useState('');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);

  useEffect(() => {
    loadFromStore();
  }, []);

  const loadFromStore = async () => {
    setLoading(true);
    try {
      const pk = await stellarService.getPublicKeyFromStoredSecret();
      setPublicKey(pk);
      if (pk) await refreshBalance(pk);
    } catch (err) {
      logger.error('stellar_screen_load_failed', {}, err as Error);
    } finally {
      setLoading(false);
    }
  };

  const refreshBalance = async (pk: string) => {
    setLoading(true);
    try {
      const res = await stellarService.getBalance(pk);
      setBalance(res ? res.balance : null);
      setQrUrl(getQRImageUrl(pk));
    } finally {
      setLoading(false);
    }
  };

  const handleImportSecret = async () => {
    const trimmed = importSecretText.trim();
    if (!/^S[A-Z2-7]{55}$/.test(trimmed)) {
      Alert.alert('Invalid Secret', 'Enter a valid Stellar secret key (starts with S, 56 chars).');
      return;
    }
    try {
      await stellarService.storeSecret(trimmed);
      setImportSecretText('');
      await loadFromStore();
      Alert.alert('Saved', 'Your secret key was saved securely. It will never be displayed.');
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to save secret.');
    }
  };

  const handleCopy = async () => {
    if (!publicKey) return;
    await Clipboard.setString(publicKey);
    Alert.alert('Copied', 'Public key copied to clipboard');
  };

  const handleFundTestnet = async () => {
    if (!publicKey) return;
    setFunding(true);
    try {
      const res = await stellarService.fundTestnet(publicKey);
      if (res.success) {
        Alert.alert('Funded', 'Testnet account funded via Friendbot.');
        await refreshBalance(publicKey);
      } else {
        Alert.alert('Funding failed', res.message ?? 'Friendbot failed');
      }
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Funding failed');
    } finally {
      setFunding(false);
    }
  };

  const loadMoreTx = async () => {
    if (!publicKey) return;
    const res = await stellarService.getTransactions(publicKey, nextCursor);
    if (res) {
      setTxs((prev) => [...prev, ...res.records]);
      setNextCursor(res.next);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Stellar Account</Text>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Public Key</Text>
              {publicKey ? (
                <>
                  <View style={styles.keyRow}>
                    <Text style={styles.keyText} numberOfLines={2}>
                      {publicKey}
                    </Text>
                    <TouchableOpacity onPress={handleCopy} style={styles.smallBtn}>
                      <Text style={styles.smallBtnText}>Copy</Text>
                    </TouchableOpacity>
                  </View>
                  {qrUrl && <Image source={{ uri: qrUrl }} style={styles.qr} />}
                </>
              ) : (
                <Text style={styles.hint}>
                  No key stored. Import your secret key securely below.
                </Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Balance</Text>
              <Text style={styles.balanceText}>{balance ?? '—'}</Text>
              <View style={styles.rowSpace}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => publicKey && refreshBalance(publicKey)}
                >
                  <Text style={styles.actionBtnText}>Refresh</Text>
                </TouchableOpacity>
                {!publicKey ? null : (
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      config.env === 'production' && styles.actionBtnDisabled,
                    ]}
                    onPress={handleFundTestnet}
                    disabled={funding || config.env === 'production'}
                  >
                    {funding ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.actionBtnText}>Fund (Testnet)</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Import Secret (kept secure)</Text>
              <TextInput
                style={[styles.input, styles.monoInput]}
                value={importSecretText}
                onChangeText={setImportSecretText}
                placeholder="SABC... (56 chars)"
                autoCapitalize="characters"
                autoCorrect={false}
                placeholderTextColor="#bbb"
                secureTextEntry
              />
              <TouchableOpacity style={styles.submitBtn} onPress={handleImportSecret}>
                <Text style={styles.submitBtnText}>Save Secret Securely</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent Transactions</Text>
              {txs.length === 0 ? (
                <Text style={styles.hint}>No transactions loaded.</Text>
              ) : (
                txs.map((tx) => (
                  <View key={tx.id} style={styles.txRow}>
                    <Text style={styles.txTitle}>{tx.id.substring(0, 10)}…</Text>
                    <Text style={styles.txTime}>{tx.created_at}</Text>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.loadMore} onPress={loadMoreTx}>
                <Text style={styles.loadMoreText}>Load more</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  keyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keyText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: '#111',
    flex: 1,
    marginRight: 8,
  },
  smallBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallBtnText: { color: '#fff', fontWeight: '700' },
  qr: { width: 160, height: 160, marginTop: 12, alignSelf: 'center' },
  hint: { color: '#666', fontSize: 13 },
  balanceText: { fontSize: 20, fontWeight: '700', marginTop: 6 },
  rowSpace: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { backgroundColor: '#4CAF50', padding: 10, borderRadius: 8 },
  actionBtnText: { color: '#fff', fontWeight: '700' },
  actionBtnDisabled: { backgroundColor: '#999' },
  input: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 10, marginTop: 8 },
  monoInput: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  submitBtn: {
    backgroundColor: '#1a73e8',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '700' },
  txRow: { borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingVertical: 10 },
  txTitle: { fontSize: 13, fontWeight: '700' },
  txTime: { fontSize: 12, color: '#666' },
  loadMore: { marginTop: 8, alignItems: 'center' },
  loadMoreText: { color: '#1a73e8', fontWeight: '700' },
});

export default StellarAccountScreen;
