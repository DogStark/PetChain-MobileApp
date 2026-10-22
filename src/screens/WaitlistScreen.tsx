/**
 * WaitlistScreen
 *
 * Allows users to:
 *   - View their current waitlist entries (position, ETA, status)
 *   - Join the waitlist for a vet + time window
 *   - Accept an offered slot (when status is NOTIFIED)
 *   - Leave the waitlist at any time
 *
 * Navigation pattern: callback-prop (matches the rest of the app).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { WaitlistStatus, type WaitlistEntry } from '../../backend/models/WaitlistEntry';
import {
  joinWaitlist,
  leaveWaitlist,
  acceptSlot,
  getUserWaitlistEntries,
  processExpiredNotifications,
  ACCEPTANCE_WINDOW_MS,
} from '../../backend/services/waitlistService';
import WebsocketService from '../services/websocketService';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:3001';
const POLL_INTERVAL_MS = 30_000;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** ID of the currently authenticated user */
  userId: string;
  /** Called when the user successfully accepts a slot and an appointment should be created */
  onSlotAccepted?: (entry: WaitlistEntry, appointmentId: string) => void;
  /** Optional back navigation callback */
  onBack?: () => void;
}

// ─── Join form state ──────────────────────────────────────────────────────────

interface JoinForm {
  vetId: string;
  petId: string;
  preferredDateStart: string;
  preferredDateEnd: string;
}

const EMPTY_FORM: JoinForm = {
  vetId: '',
  petId: '',
  preferredDateStart: '',
  preferredDateEnd: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatStatus(status: WaitlistStatus): string {
  switch (status) {
    case WaitlistStatus.WAITING:
      return '⏳ Waiting';
    case WaitlistStatus.NOTIFIED:
      return '🔔 Slot Available';
    case WaitlistStatus.ACCEPTED:
      return '✅ Accepted';
    case WaitlistStatus.EXPIRED:
      return '⌛ Expired';
    case WaitlistStatus.CANCELLED:
      return '❌ Cancelled';
  }
}

function statusColor(status: WaitlistStatus): string {
  switch (status) {
    case WaitlistStatus.WAITING:
      return '#FF9800';
    case WaitlistStatus.NOTIFIED:
      return '#2196F3';
    case WaitlistStatus.ACCEPTED:
      return '#4CAF50';
    case WaitlistStatus.EXPIRED:
      return '#9E9E9E';
    case WaitlistStatus.CANCELLED:
      return '#F44336';
  }
}

function formatEta(minutes: number): string {
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

function formatDeadlineCountdown(deadline: string): string {
  const remaining = new Date(deadline).getTime() - Date.now();
  if (remaining <= 0) return 'Expired';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')} remaining`;
}

// ─── Animated position badge ──────────────────────────────────────────────────

const AnimatedPositionBadge: React.FC<{ position: number }> = ({ position }) => {
  const scale = useSharedValue(1);
  const prevPosition = useRef(position);

  useEffect(() => {
    if (prevPosition.current !== position) {
      prevPosition.current = position;
      scale.value = withSequence(withSpring(1.35), withTiming(1, { duration: 250 }));
    }
  }, [position, scale]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (position === 1) {
    return (
      <Animated.View style={[styles.youreNextBadge, animStyle]}>
        <Text style={styles.youreNextText}>🎉 You're next!</Text>
      </Animated.View>
    );
  }

  return <Animated.Text style={[styles.positionText, animStyle]}>#{position}</Animated.Text>;
};

// ─── Component ────────────────────────────────────────────────────────────────

const WaitlistScreen: React.FC<Props> = ({ userId, onSlotAccepted, onBack }) => {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<JoinForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [countdowns, setCountdowns] = useState<Record<string, string>>({});

  // Countdown ticker ref — cleared on unmount
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebsocketService | null>(null);

  // ── Load entries ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Process any expired notifications before rendering
      await processExpiredNotifications();
      const result = await getUserWaitlistEntries(userId);
      setEntries(result.data);
    } catch {
      Alert.alert('Error', 'Failed to load waitlist entries.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // ── Apply a position update from WS without full reload ────────────────────
  const applyPositionUpdate = useCallback(
    (data: { entryId: string; position: number; estimatedWaitMinutes: number }) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === data.entryId
            ? { ...e, position: data.position, estimatedWaitMinutes: data.estimatedWaitMinutes }
            : e,
        ),
      );
    },
    [],
  );

  // ── WebSocket setup + polling fallback ─────────────────────────────────────
  useEffect(() => {
    void load();

    const ws = new WebsocketService(WS_URL);
    wsRef.current = ws;

    const unsubPosition = ws.on('waitlist:position_update', (data) => {
      applyPositionUpdate(data);
    });

    const unsubConnected = ws.on('connected', () => {
      setIsOffline(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    });

    const unsubDisconnected = ws.on('disconnected', () => {
      setIsOffline(true);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => void load(), POLL_INTERVAL_MS);
      }
    });

    ws.connect();

    return () => {
      unsubPosition();
      unsubConnected();
      unsubDisconnected();
      ws.disconnect();
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Countdown ticker for NOTIFIED entries ───────────────────────────────────

  useEffect(() => {
    const notified = entries.filter(
      (e) => e.status === WaitlistStatus.NOTIFIED && e.acceptanceDeadline,
    );

    if (notified.length === 0) {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
      return;
    }

    const tick = () => {
      const next: Record<string, string> = {};
      for (const e of notified) {
        if (e.acceptanceDeadline) {
          next[e.id] = formatDeadlineCountdown(e.acceptanceDeadline);
        }
      }
      setCountdowns(next);
    };

    tick(); // immediate first tick
    tickerRef.current = setInterval(tick, 1000);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [entries]);

  // ── Join waitlist ───────────────────────────────────────────────────────────

  const handleJoin = async () => {
    const { vetId, petId, preferredDateStart, preferredDateEnd } = form;

    if (!vetId.trim() || !petId.trim() || !preferredDateStart.trim() || !preferredDateEnd.trim()) {
      Alert.alert('Validation', 'All fields are required.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await joinWaitlist({
        userId,
        vetId: vetId.trim(),
        petId: petId.trim(),
        preferredDateStart: preferredDateStart.trim(),
        preferredDateEnd: preferredDateEnd.trim(),
      });

      if (!result.success) {
        Alert.alert('Could not join', result.message ?? 'Unknown error.');
        return;
      }

      setModalVisible(false);
      setForm(EMPTY_FORM);
      void load();
    } catch {
      Alert.alert('Error', 'Failed to join the waitlist. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Leave waitlist ──────────────────────────────────────────────────────────

  const handleLeave = (entry: WaitlistEntry) => {
    Alert.alert('Leave Waitlist', 'Are you sure you want to remove yourself from this waitlist?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            const result = await leaveWaitlist(entry.id);
            if (!result.success) {
              Alert.alert('Error', result.message ?? 'Could not leave the waitlist.');
              return;
            }
            void load();
          } catch {
            Alert.alert('Error', 'Failed to leave the waitlist.');
          }
        },
      },
    ]);
  };

  // ── Accept slot ─────────────────────────────────────────────────────────────

  const handleAccept = (entry: WaitlistEntry) => {
    Alert.alert('Accept Slot', 'Confirm you want to book this appointment slot.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Accept',
        onPress: async () => {
          try {
            // In a real integration the appointmentId would come from the server
            // after creating the appointment. Here we generate a placeholder that
            // the caller (onSlotAccepted) can replace with the real ID.
            const placeholderAppointmentId = `apt_${Date.now()}`;
            const result = await acceptSlot(entry.id, placeholderAppointmentId);

            if (!result.success) {
              Alert.alert('Could not accept', result.message ?? 'Unknown error.');
              void load(); // refresh — entry may have expired
              return;
            }

            void load();
            onSlotAccepted?.(result.data, placeholderAppointmentId);
          } catch {
            Alert.alert('Error', 'Failed to accept the slot.');
          }
        },
      },
    ]);
  };

  // ── Render entry card ───────────────────────────────────────────────────────

  const renderEntry = ({ item }: { item: WaitlistEntry }) => {
    const isActive =
      item.status === WaitlistStatus.WAITING || item.status === WaitlistStatus.NOTIFIED;
    const isNotified = item.status === WaitlistStatus.NOTIFIED;

    return (
      <View style={[styles.card, isNotified && styles.cardHighlighted]}>
        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) }]}>
          <Text style={styles.statusText}>{formatStatus(item.status)}</Text>
        </View>

        <Text style={styles.cardLabel}>
          Vet: <Text style={styles.cardValue}>{item.vetId}</Text>
        </Text>
        <Text style={styles.cardLabel}>
          Pet: <Text style={styles.cardValue}>{item.petId}</Text>
        </Text>
        <Text style={styles.cardLabel}>
          Preferred window:{' '}
          <Text style={styles.cardValue}>
            {item.preferredDateStart} → {item.preferredDateEnd}
          </Text>
        </Text>

        {item.status === WaitlistStatus.WAITING && (
          <>
            <Text style={styles.cardLabel}>Position:</Text>
            <AnimatedPositionBadge position={item.position} />
            <Text style={styles.cardLabel}>
              Est. wait:{' '}
              <Text style={styles.cardValue}>{formatEta(item.estimatedWaitMinutes)}</Text>
            </Text>
          </>
        )}

        {isNotified && item.acceptanceDeadline && (
          <View style={styles.countdownBox}>
            <Text style={styles.countdownText}>
              ⏱ {countdowns[item.id] ?? formatDeadlineCountdown(item.acceptanceDeadline)}
            </Text>
            <Text style={styles.countdownHint}>Accept before the window closes</Text>
          </View>
        )}

        {item.status === WaitlistStatus.ACCEPTED && item.appointmentId && (
          <Text style={styles.cardLabel}>
            Appointment: <Text style={styles.cardValue}>{item.appointmentId}</Text>
          </Text>
        )}

        {/* Action buttons */}
        {isNotified && (
          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={() => handleAccept(item)}
            accessibilityRole="button"
            accessibilityLabel="Accept appointment slot"
          >
            <Text style={styles.acceptBtnText}>Accept Slot</Text>
          </TouchableOpacity>
        )}

        {isActive && (
          <TouchableOpacity
            style={styles.leaveBtn}
            onPress={() => handleLeave(item)}
            accessibilityRole="button"
            accessibilityLabel="Leave waitlist"
          >
            <Text style={styles.leaveBtnText}>Leave Waitlist</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ── Join modal ──────────────────────────────────────────────────────────────

  const renderModal = () => (
    <Modal
      visible={modalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Join Waitlist</Text>

          <TextInput
            style={styles.input}
            placeholder="Vet ID *"
            value={form.vetId}
            onChangeText={(v) => setForm((f) => ({ ...f, vetId: v }))}
            autoCapitalize="none"
            accessibilityLabel="Vet ID"
          />
          <TextInput
            style={styles.input}
            placeholder="Pet ID *"
            value={form.petId}
            onChangeText={(v) => setForm((f) => ({ ...f, petId: v }))}
            autoCapitalize="none"
            accessibilityLabel="Pet ID"
          />
          <TextInput
            style={styles.input}
            placeholder="Preferred start date (YYYY-MM-DD) *"
            value={form.preferredDateStart}
            onChangeText={(v) => setForm((f) => ({ ...f, preferredDateStart: v }))}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Preferred start date"
          />
          <TextInput
            style={styles.input}
            placeholder="Preferred end date (YYYY-MM-DD) *"
            value={form.preferredDateEnd}
            onChangeText={(v) => setForm((f) => ({ ...f, preferredDateEnd: v }))}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Preferred end date"
          />

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                setModalVisible(false);
                setForm(EMPTY_FORM);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
              onPress={() => void handleJoin()}
              disabled={submitting}
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Join</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backBtnText}>‹ Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Appointment Waitlist</Text>
        {isOffline && (
          <View style={styles.offlineBadge} accessibilityLabel="Offline — polling for updates">
            <Text style={styles.offlineBadgeText}>● Offline</Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Join waitlist"
        >
          <Text style={styles.addBtnText}>+ Join</Text>
        </TouchableOpacity>
      </View>

      {/* Info banner */}
      <View style={styles.infoBanner}>
        <Text style={styles.infoText}>
          When a slot opens you'll get a notification. You have {ACCEPTANCE_WINDOW_MS / 60000}{' '}
          minutes to accept before it's offered to the next person.
        </Text>
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#4CAF50" />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={renderEntry}
          contentContainerStyle={styles.listContent}
          onRefresh={load}
          refreshing={loading}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              You're not on any waitlists yet.{'\n'}Tap "+ Join" to get started.
            </Text>
          }
        />
      )}

      {renderModal()}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { marginRight: 8 },
  backBtnText: { fontSize: 18, color: '#4CAF50', fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  addBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '600' },

  offlineBadge: {
    backgroundColor: '#F44336',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 8,
  },
  offlineBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  infoBanner: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#BBDEFB',
  },
  infoText: { fontSize: 13, color: '#1565C0', lineHeight: 18 },

  loader: { marginTop: 40 },
  listContent: { padding: 12 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHighlighted: {
    borderWidth: 2,
    borderColor: '#2196F3',
  },

  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  cardLabel: { fontSize: 13, color: '#555', marginTop: 3 },
  cardValue: { fontWeight: '600', color: '#1a1a1a' },

  positionText: { fontSize: 22, fontWeight: '700', color: '#FF9800', marginVertical: 4 },
  youreNextBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  youreNextText: { fontSize: 16, fontWeight: '700', color: '#2E7D32' },

  countdownBox: {
    marginTop: 10,
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  countdownText: { fontSize: 20, fontWeight: '700', color: '#1565C0' },
  countdownHint: { fontSize: 12, color: '#1565C0', marginTop: 2 },

  acceptBtn: {
    marginTop: 12,
    backgroundColor: '#2196F3',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  leaveBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#F44336',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  leaveBtnText: { color: '#F44336', fontWeight: '600', fontSize: 13 },

  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
    fontSize: 15,
    lineHeight: 22,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 14, color: '#1a1a1a' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
    backgroundColor: '#fafafa',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#666', fontWeight: '600' },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '600' },
});

export default WaitlistScreen;
