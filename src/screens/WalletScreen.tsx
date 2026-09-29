import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import { useWallet } from '../hooks/useWallet';
import { shortenAddress } from '../utils/format';

/**
 * Default clipboard timeout (ms) for copied identifiers.
 * Platform support for programmatic clipboard writes/reads varies:
 * - iOS: reading the clipboard may show a system paste notification; writes are
 *   supported but the OS may keep the value in the pasteboard beyond our timer.
 * - Android: writes are supported; on Android 10+ background clipboard access is
 *   restricted, so cleanup only runs while the app is foregrounded.
 * The timeout is best-effort: we only clear the clipboard if it still holds the
 * exact value we set, so newer user clipboard content is never overwritten.
 */
export const DEFAULT_CLIPBOARD_TIMEOUT_MS = 60_000;

const CLIPBOARD_TIMEOUT_MS = DEFAULT_CLIPBOARD_TIMEOUT_MS;

interface CopyTarget {
  /** Human-readable label describing exactly what will be copied. */
  label: string;
  /** The value that will be placed on the clipboard. */
  value: string;
}

const WalletScreen: React.FC = () => {
  const { wallet, records } = useWallet();
  const [lastCopied, setLastCopied] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const clearClipboardIfUnchanged = useCallback(async (expected: string) => {
    try {
      const current = await Clipboard.getString();
      // Only clear when the clipboard still holds the value we set, so we never
      // overwrite newer user clipboard content.
      if (current === expected) {
        Clipboard.setString('');
      }
    } catch {
      // Clipboard read may be unavailable (e.g. backgrounded on Android 10+).
      // Failing to clear is acceptable; we never clobber unknown content.
    }
  }, []);

  const copyWithTimeout = useCallback(
    (target: CopyTarget) => {
      // Explicit user action only: sensitive payloads are never copied silently.
      Clipboard.setString(target.value);
      setLastCopied(target.label);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        void clearClipboardIfUnchanged(target.value);
      }, CLIPBOARD_TIMEOUT_MS);
    },
    [clearClipboardIfUnchanged],
  );

  const handleCopyAddress = useCallback(() => {
    if (!wallet?.address) {
      return;
    }
    Alert.alert(
      'Copy wallet address?',
      `This will copy your full wallet address to the clipboard:\n\n${wallet.address}\n\nIt will be cleared after ${Math.round(
        CLIPBOARD_TIMEOUT_MS / 1000,
      )}s if unchanged.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: () =>
            copyWithTimeout({ label: 'Wallet address', value: wallet.address }),
        },
      ],
    );
  }, [wallet?.address, copyWithTimeout]);

  const handleCopyRecord = useCallback(
    (recordId: string) => {
      Alert.alert(
        'Copy record reference?',
        `This will copy the record reference to the clipboard:\n\n${recordId}\n\nIt will be cleared after ${Math.round(
          CLIPBOARD_TIMEOUT_MS / 1000,
        )}s if unchanged.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Copy',
            onPress: () =>
              copyWithTimeout({ label: 'Record reference', value: recordId }),
          },
        ],
      );
    },
    [copyWithTimeout],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Wallet</Text>

      {wallet?.address ? (
        <View style={styles.card}>
          <Text style={styles.label}>Address</Text>
          <Text style={styles.address}>{shortenAddress(wallet.address)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy wallet address"
            style={styles.copyButton}
            onPress={handleCopyAddress}
          >
            <Text style={styles.copyButtonText}>Copy address</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.empty}>No wallet available.</Text>
      )}

      <Text style={styles.sectionHeading}>Records</Text>
      {records && records.length > 0 ? (
        records.map((record) => (
          <View key={record.id} style={styles.card}>
            <Text style={styles.label}>{record.title ?? 'Record'}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy record reference"
              style={styles.copyButton}
              onPress={() => handleCopyRecord(record.id)}
            >
              <Text style={styles.copyButtonText}>Copy reference</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>No records yet.</Text>
      )}

      {lastCopied ? (
        <Text style={styles.status}>
          Copied {lastCopied}. Clipboard clears after{' '}
          {Math.round(CLIPBOARD_TIMEOUT_MS / 1000)}s if unchanged.
        </Text>
      ) : null}

      <Text style={styles.note}>
        Clipboard timeout is best-effort. On iOS the system pasteboard may retain
        the value, and on Android 10+ cleanup only runs while the app is in the
        foreground. Sensitive payloads are never copied without your explicit
        confirmation.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 48,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 12,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  address: {
    fontSize: 16,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    marginBottom: 12,
  },
  copyButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#1f6feb',
  },
  copyButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  empty: {
    color: '#888',
  },
  status: {
    marginTop: 16,
    color: '#1f6feb',
  },
  note: {
    marginTop: 24,
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
  },
});

export default WalletScreen;
