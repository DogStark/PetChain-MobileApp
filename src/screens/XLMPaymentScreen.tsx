import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface PaymentIntent {
  transactionId: string;
  destination: string;
  amountXlm: number;
  memo: string;
  expiresAt: string;
}

export default function XLMPaymentScreen() {
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'waiting' | 'confirmed' | 'error'>(
    'idle',
  );
  const [countdown, setCountdown] = useState(1800);

  const createIntent = useCallback(async () => {
    setStatus('loading');

    try {
      const res = await fetch('/api/payments/xlm/intent', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create payment intent');

      const data: PaymentIntent = await res.json();
      setIntent(data);
      setStatus('waiting');
      setCountdown(
        Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000)),
      );
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (status !== 'waiting') return undefined;

    const timer = setInterval(() => {
      setCountdown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status !== 'waiting' || !intent) return undefined;

    const timer = setInterval(async () => {
      try {
        await fetch('/api/payments/xlm/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionId: intent.transactionId }),
        });
      } catch {
        setStatus('error');
      }
    }, 10000);

    return () => clearInterval(timer);
  }, [intent, status]);

  const copyToClipboard = (text: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied', 'Copied to clipboard');
  };

  const formatCountdown = (secs: number) =>
    `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pay with XLM</Text>
      <Text style={styles.subtitle}>Unlock PetChain Premium</Text>

      {status === 'idle' && (
        <TouchableOpacity style={styles.button} onPress={createIntent}>
          <Text style={styles.buttonText}>Generate Payment Address</Text>
        </TouchableOpacity>
      )}

      {status === 'loading' && <ActivityIndicator size="large" color="#4A90A4" />}

      {status === 'waiting' && intent && (
        <View style={styles.paymentCard}>
          <Text style={styles.label}>Send exactly</Text>
          <Text style={styles.amount}>{intent.amountXlm} XLM</Text>

          <Text style={styles.label}>To address</Text>
          <TouchableOpacity onPress={() => copyToClipboard(intent.destination)}>
            <Text style={styles.address}>{intent.destination}</Text>
            <Text style={styles.copy}>Tap to copy</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Memo required</Text>
          <TouchableOpacity onPress={() => copyToClipboard(intent.memo)}>
            <Text style={styles.memo}>{intent.memo}</Text>
            <Text style={styles.copy}>Tap to copy</Text>
          </TouchableOpacity>

          <Text style={styles.warning}>Include the memo or payment cannot be matched.</Text>
          <Text style={styles.countdown}>Expires in {formatCountdown(countdown)}</Text>
        </View>
      )}

      {status === 'confirmed' && (
        <View style={styles.success}>
          <Text style={styles.successText}>Payment confirmed. Premium activated.</Text>
        </View>
      )}

      {status === 'error' && (
        <Text style={styles.error}>Something went wrong. Please try again.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 32 },
  button: { backgroundColor: '#4A90A4', padding: 16, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  paymentCard: { backgroundColor: '#F4F8F9', borderRadius: 8, padding: 20 },
  label: { fontSize: 12, color: '#667', marginTop: 12 },
  amount: { fontSize: 32, fontWeight: '800', color: '#4A90A4' },
  address: { fontSize: 13, fontFamily: 'monospace', color: '#222' },
  memo: { fontSize: 14, fontFamily: 'monospace', fontWeight: '600', color: '#4A90A4' },
  copy: { fontSize: 11, color: '#777', marginTop: 2 },
  warning: { fontSize: 12, color: '#B54708', marginTop: 8 },
  countdown: { fontSize: 13, color: '#667', textAlign: 'center', marginTop: 16 },
  success: { alignItems: 'center', marginTop: 32 },
  successText: { fontSize: 18, color: '#2E7D32', fontWeight: '600' },
  error: { color: '#B42318', textAlign: 'center', marginTop: 16 },
});
