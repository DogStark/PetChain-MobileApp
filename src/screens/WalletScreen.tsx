import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import { useWallet } from '../hooks/useWallet';
import { shortenAddress } from '../utils/format';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  buildActivityCsv,
  getActivityAccessibilityLabel,
  getActivityViewState,
  getEmptyStateMessage,
  loadFilteredActivity,
  loadNextActivityPage,
  validateFilters,
  type ActivityFilters,
  type ActivityType,
  type WalletActivity,
} from '../services/walletActivityFilterService';
import { validateExpenseDateRange } from '../services/expenseExportService';

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

  const [filters, setFilters] = useState<ActivityFilters>({});
  const [activity, setActivity] = useState<WalletActivity[]>([]);
  const [nextLink, setNextLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  const loadActivity = useCallback(async (next: ActivityFilters) => {
    const errors = validateFilters(next);
    setFilterError(errors[0] ?? null);
    if (errors.length > 0) return;

    setLoading(true);
    try {
      const res = await loadFilteredActivity(next);
      setActivity(res.data?.items ?? []);
      setNextLink(res.data?.nextLink ?? null);
    } catch {
      setActivity([]);
      setNextLink(null);
      Alert.alert('Error', 'Failed to load wallet activity.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity(filters);
  }, [filters, loadActivity]);

  const handleLoadMore = useCallback(async () => {
    if (!nextLink || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadNextActivityPage(nextLink);
      if (page) {
        setActivity((prev) => [...prev, ...page.items]);
        setNextLink(page.nextLink);
      } else {
        setNextLink(null);
      }
    } catch {
      Alert.alert('Error', 'Failed to load more activity.');
    } finally {
      setLoadingMore(false);
    }
  }, [nextLink, loadingMore]);

  const handleExport = useCallback(async () => {
    const rangeError = validateExpenseDateRange(
      filters.from ?? '',
      filters.to ?? '',
    );
    if (rangeError) {
      Alert.alert('Export unavailable', 'Choose a valid date range to export.');
      return;
    }
    try {
      await Share.share({
        title: 'Wallet activity CSV',
        message: buildActivityCsv(activity),
      });
    } catch {
      Alert.alert('Error', 'Failed to export wallet activity.');
    }
  }, [activity, filters.from, filters.to]);

  const toggleType = useCallback((type: ActivityType) => {
    setFilters((prev) => ({ ...prev, type: prev.type === type ? undefined : type }));
  }, []);

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

      <Text style={styles.sectionHeading}>Activity</Text>

      <View style={styles.filterBar}>
        <Text style={styles.label}>From</Text>
        <TextInput
          accessibilityLabel="Activity start date"
          placeholder="YYYY-MM-DD"
          value={filters.from ?? ''}
          onChangeText={(from) => setFilters((prev) => ({ ...prev, from: from || undefined }))}
          style={styles.input}
        />
        <Text style={styles.label}>To</Text>
        <TextInput
          accessibilityLabel="Activity end date"
          placeholder="YYYY-MM-DD"
          value={filters.to ?? ''}
          onChangeText={(to) => setFilters((prev) => ({ ...prev, to: to || undefined }))}
          style={styles.input}
        />
        <View style={styles.chipRow}>
          {ACTIVITY_TYPES.map((type) => (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ selected: filters.type === type }}
              accessibilityLabel={`Filter by ${ACTIVITY_TYPE_LABELS[type]}`}
              style={[styles.chip, filters.type === type && styles.chipSelected]}
              onPress={() => toggleType(type)}
            >
              <Text style={styles.chipText}>{ACTIVITY_TYPE_LABELS[type]}</Text>
            </Pressable>
          ))}
        </View>
        {filterError ? <Text style={styles.error}>{filterError}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export wallet activity as CSV"
          style={styles.copyButton}
          onPress={handleExport}
        >
          <Text style={styles.copyButtonText}>Export CSV</Text>
        </Pressable>
      </View>

      {loading ? <Text style={styles.empty}>Loading activity…</Text> : null}
      {!loading && activity.length === 0 ? (
        <Text style={styles.empty}>
          {getEmptyStateMessage(filters, getActivityViewState(activity))}
        </Text>
      ) : null}
      {activity.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <Text
            style={styles.label}
            accessibilityLabel={getActivityAccessibilityLabel(entry)}
          >
            {entry.type ? `${ACTIVITY_TYPE_LABELS[entry.type]} · ` : ''}
            {entry.amount} {entry.asset} · {entry.status}
          </Text>
          <Text style={styles.label}>{entry.createdAt.slice(0, 10)}</Text>
        </View>
      ))}
      {nextLink ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Load more activity"
          style={styles.copyButton}
          onPress={handleLoadMore}
          disabled={loadingMore}
        >
          <Text style={styles.copyButtonText}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Text>
        </Pressable>
      ) : null}

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
  filterBar: {
    marginBottom: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: {
    backgroundColor: '#1f6feb',
    borderColor: '#1f6feb',
  },
  chipText: {
    fontSize: 13,
  },
  error: {
    color: '#c62828',
    marginBottom: 8,
  },
});

export default WalletScreen;
