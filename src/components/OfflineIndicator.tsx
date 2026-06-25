import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  offlineQueue,
  type OfflineQueueStatus,
  type QueuedMutation,
} from '../services/offlineQueue';

// ─── Type labels ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  medicalRecord: 'medical record',
  medication: 'medication',
  appointment: 'appointment',
  pet: 'pet',
};

function buildBreakdown(queue: QueuedMutation[]): string[] {
  const counts: Record<string, number> = {};
  for (const item of queue) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return Object.entries(counts).map(
    ([type, count]) => `${count} ${TYPE_LABELS[type] ?? type}${count > 1 ? 's' : ''}`,
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

const OfflineIndicator: React.FC = () => {
  const [status, setStatus] = useState<OfflineQueueStatus | null>(null);
  const [savedVisible, setSavedVisible] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [pendingItems, setPendingItems] = useState<QueuedMutation[]>([]);
  const visibleAnim = useRef(new Animated.Value(0)).current;
  const prevOnline = useRef<boolean | null>(null);

  useEffect(() => {
    void offlineQueue.getStatus().then(setStatus);
    const unsubscribe = offlineQueue.onStatusChange((s) => {
      // When coming back online after being offline → show "All changes saved ✓"
      if (prevOnline.current === false && s.isOnline && !s.isSyncing && s.pendingCount === 0) {
        setSavedVisible(true);
        setTimeout(() => setSavedVisible(false), 3000);
      }
      prevOnline.current = s.isOnline;
      setStatus(s);
    });
    return unsubscribe;
  }, []);

  const shouldShow =
    savedVisible ||
    (status !== null && (!status.isOnline || status.isSyncing || status.pendingCount > 0));

  useEffect(() => {
    Animated.timing(visibleAnim, {
      toValue: shouldShow ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [shouldShow, visibleAnim]);

  const handlePress = async () => {
    const items = await offlineQueue.getPersistentQueue();
    setPendingItems(items);
    setSheetVisible(true);
  };

  if (!status && !savedVisible) return null;

  let message = '';
  let bgColor = '#666';

  if (savedVisible) {
    message = '✓ All changes saved';
    bgColor = '#4CAF50';
  } else if (status) {
    if (!status.isOnline) {
      message =
        status.pendingCount > 0
          ? `📴 Offline · ${status.pendingCount} change${status.pendingCount > 1 ? 's' : ''} pending`
          : '📴 Offline';
      bgColor = '#d32f2f';
    } else if (status.isSyncing) {
      message = '🔄 Syncing…';
      bgColor = '#4CAF50';
    } else if (status.pendingCount > 0) {
      message = `⏳ ${status.pendingCount} change${status.pendingCount > 1 ? 's' : ''} pending sync`;
      bgColor = '#FFA000';
    }
  }

  const translateY = visibleAnim.interpolate({ inputRange: [0, 1], outputRange: [-50, 0] });
  const breakdown = buildBreakdown(pendingItems);

  return (
    <>
      <Animated.View
        style={[styles.container, { backgroundColor: bgColor, transform: [{ translateY }] }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={message}
      >
        <TouchableOpacity
          onPress={() => void handlePress()}
          activeOpacity={0.8}
          style={styles.touchable}
        >
          <Text style={styles.text}>{message}</Text>
          {!savedVisible && (status?.pendingCount ?? 0) > 0 && (
            <Text style={styles.chevron}>›</Text>
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* ── Bottom sheet ── */}
      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
        accessibilityViewIsModal
      >
        <Pressable style={styles.backdrop} onPress={() => setSheetVisible(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Pending Changes</Text>
          {breakdown.length > 0 ? (
            breakdown.map((line, i) => (
              <Text key={i} style={styles.sheetItem}>
                • {line}
              </Text>
            ))
          ) : (
            <Text style={styles.sheetEmpty}>No pending changes.</Text>
          )}
          <TouchableOpacity
            style={styles.sheetClose}
            onPress={() => setSheetVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.sheetCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'ios' ? 44 : 10,
    paddingBottom: 10,
    zIndex: 9999,
    elevation: 10,
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  text: { color: '#fff', fontSize: 14, fontWeight: '600' },
  chevron: { color: '#fff', fontSize: 18, fontWeight: '600', lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  sheetItem: { fontSize: 15, color: '#333', paddingVertical: 4 },
  sheetEmpty: { fontSize: 14, color: '#888' },
  sheetClose: {
    marginTop: 20,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sheetCloseText: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
});

export default OfflineIndicator;

export function useOfflineStatus() {
  const [status, setStatus] = React.useState<OfflineQueueStatus | null>(null);

  useEffect(() => {
    offlineQueue.getStatus().then(setStatus);
    const unsubscribe = offlineQueue.onStatusChange(setStatus);
    return unsubscribe;
  }, []);

  return {
    isOnline: status?.isOnline ?? true,
    isSyncing: status?.isSyncing ?? false,
    pendingCount: status?.pendingCount ?? 0,
  };
}

export function HeaderOfflineStatus() {
  const { isOnline } = useOfflineStatus();
  if (isOnline) return null;
  return <Text style={{ color: '#d32f2f', fontSize: 12, fontWeight: '600' }}>Offline</Text>;
}
