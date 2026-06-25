import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { SkeletonCard } from '../components/SkeletonCard';
import { useMinimumLoadingTime } from '../hooks/useMinimumLoadingTime';
import {
  getMessages,
  getVetProfile,
  searchVets,
  sendMessage,
  type VetMessage,
  type VetProfile,
} from '../services/vetService';

type Screen = 'directory' | 'profile' | 'chat';

const VetDirectoryScreen: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('directory');
  const [vets, setVets] = useState<VetProfile[]>([]);
  const [selectedVet, setSelectedVet] = useState<VetProfile | null>(null);
  const [loading, setLoading] = useState(false);

  // Enforce minimum 300ms display for skeleton
  const displayLoading = useMinimumLoadingTime(loading, { minLoadingTime: 300 });

  // Search filters
  const [specialty, setSpecialty] = useState('');
  const [radius, setRadius] = useState('25');
  const [availableOnly, setAvailableOnly] = useState(false);

  // Chat
  const [messages, setMessages] = useState<VetMessage[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const results = await searchVets({
        specialty: specialty || undefined,
        radius: parseFloat(radius) || 25,
        available: availableOnly || undefined,
      });
      setVets(results);
    } catch {
      Alert.alert('Error', 'Failed to search vets');
    } finally {
      setLoading(false);
    }
  }, [specialty, radius, availableOnly]);

  useEffect(() => {
    void doSearch();
  }, [doSearch]);

  const openProfile = useCallback(async (vet: VetProfile) => {
    try {
      const profile = await getVetProfile(vet.id);
      setSelectedVet(profile);
      setScreen('profile');
    } catch {
      Alert.alert('Error', 'Failed to load vet profile');
    }
  }, []);

  const openChat = useCallback(async (vet: VetProfile) => {
    setSelectedVet(vet);
    setChatLoading(true);
    try {
      const history = await getMessages(vet.id);
      setMessages(history);
      setScreen('chat');
    } catch {
      Alert.alert('Error', 'Failed to load messages');
    } finally {
      setChatLoading(false);
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!msgInput.trim() || !selectedVet) return;
    const text = msgInput.trim();
    setMsgInput('');
    try {
      const msg = await sendMessage(selectedVet.id, { content: text });
      setMessages((prev) => [...prev, msg]);
    } catch {
      Alert.alert('Error', 'Failed to send message');
    }
  }, [msgInput, selectedVet]);

  // ─── Directory ───────────────────────────────────────────────────────────────
  if (screen === 'directory') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Vet Directory</Text>

        <View style={styles.filters}>
          <TextInput
            style={styles.input}
            placeholder="Specialty (e.g. Dermatology)"
            value={specialty}
            onChangeText={setSpecialty}
            returnKeyType="search"
            onSubmitEditing={() => void doSearch()}
          />
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1, marginRight: 8 }]}
              placeholder="Radius (km)"
              value={radius}
              onChangeText={setRadius}
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={[styles.toggleBtn, availableOnly && styles.toggleActive]}
              onPress={() => setAvailableOnly((v) => !v)}
              accessibilityLabel="Toggle available only"
            >
              <Text style={availableOnly ? styles.toggleTextActive : styles.toggleText}>
                Available only
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.searchBtn} onPress={() => void doSearch()}>
            <Text style={styles.searchBtnText}>Search</Text>
          </TouchableOpacity>
        </View>

        {displayLoading ? (
          <View style={styles.list}>
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonCard key={`skeleton-${index}`} />
            ))}
          </View>
        ) : (
          <FlatList
            data={vets}
            keyExtractor={(v) => v.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.card}
                onPress={() => void openProfile(item)}
                accessibilityLabel={`View profile of ${item.name}`}
              >
                <View style={styles.cardInfo}>
                  <Text style={styles.vetName}>{item.name}</Text>
                  <Text style={styles.vetSub}>{item.specialty}</Text>
                  <Text style={styles.vetSub}>
                    ⭐ {item.rating.toFixed(1)} · {item.reviewCount} reviews
                    {item.distance !== undefined ? ` · ${item.distance.toFixed(1)} km` : ''}
                  </Text>
                </View>
                <View style={[styles.badge, item.available ? styles.badgeGreen : styles.badgeGray]}>
                  <Text style={styles.badgeText}>{item.available ? 'Available' : 'Busy'}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No vets found.</Text>}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    );
  }

  // ─── Profile ─────────────────────────────────────────────────────────────────
  if (screen === 'profile' && selectedVet) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.profileContent}>
        <TouchableOpacity onPress={() => setScreen('directory')} style={styles.back}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{selectedVet.name}</Text>
        <Text style={styles.label}>Specialty</Text>
        <Text style={styles.value}>{selectedVet.specialty}</Text>
        <Text style={styles.label}>Credentials</Text>
        <Text style={styles.value}>{selectedVet.credentials || '—'}</Text>
        <Text style={styles.label}>Accepted Insurance</Text>
        <Text style={styles.value}>
          {selectedVet.acceptedInsurance.length ? selectedVet.acceptedInsurance.join(', ') : '—'}
        </Text>
        <Text style={styles.label}>Rating</Text>
        <Text style={styles.value}>
          ⭐ {selectedVet.rating.toFixed(1)} ({selectedVet.reviewCount} reviews)
        </Text>
        <Text style={styles.label}>Address</Text>
        <Text style={styles.value}>{selectedVet.address || '—'}</Text>
        <Text style={styles.label}>Phone</Text>
        <Text style={styles.value}>{selectedVet.phone || '—'}</Text>

        <TouchableOpacity
          style={[styles.searchBtn, { marginTop: 24 }]}
          onPress={() => void openChat(selectedVet)}
          accessibilityLabel={`Message ${selectedVet.name}`}
        >
          <Text style={styles.searchBtnText}>💬 Message</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────────
  if (screen === 'chat' && selectedVet) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={() => setScreen('profile')} style={styles.back}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.chatTitle}>{selectedVet.name}</Text>
        </View>

        {chatLoading ? (
          <ActivityIndicator style={styles.loader} size="large" color="#4299e1" />
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => {
              const isMine = item.senderId !== selectedVet.userId;
              return (
                <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {item.content ? (
                    <Text style={isMine ? styles.bubbleTextMine : styles.bubbleText}>
                      {item.content}
                    </Text>
                  ) : null}
                  {item.attachmentUrl ? <Text style={styles.attachment}>📎 Attachment</Text> : null}
                  <Text style={styles.timestamp}>
                    {new Date(item.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              );
            }}
            contentContainerStyle={styles.chatList}
            ListEmptyComponent={<Text style={styles.empty}>No messages yet. Say hello!</Text>}
          />
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.chatInput}
            placeholder="Type a message…"
            value={msgInput}
            onChangeText={setMsgInput}
            multiline
            accessibilityLabel="Message input"
          />
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => void handleSend()}
            disabled={!msgInput.trim()}
            accessibilityLabel="Send message"
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#1a202c', padding: 16, paddingBottom: 8 },
  filters: { paddingHorizontal: 16, paddingBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    fontSize: 14,
    color: '#1a202c',
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  toggleActive: { backgroundColor: '#4299e1', borderColor: '#4299e1' },
  toggleText: { color: '#718096', fontSize: 13 },
  toggleTextActive: { color: '#fff', fontSize: 13 },
  searchBtn: {
    backgroundColor: '#4299e1',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  loader: { marginTop: 40 },
  list: { padding: 12 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#f7fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    alignItems: 'center',
  },
  cardInfo: { flex: 1 },
  vetName: { fontSize: 15, fontWeight: '600', color: '#1a202c' },
  vetSub: { fontSize: 13, color: '#718096', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeGreen: { backgroundColor: '#c6f6d5' },
  badgeGray: { backgroundColor: '#e2e8f0' },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#2d3748' },
  empty: { textAlign: 'center', color: '#718096', marginTop: 40 },
  profileContent: { padding: 16 },
  back: { marginBottom: 8 },
  backText: { color: '#4299e1', fontSize: 16 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#718096',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  value: { fontSize: 15, color: '#1a202c', marginTop: 2 },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  chatTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#1a202c' },
  chatList: { padding: 12, flexGrow: 1 },
  bubble: { maxWidth: '75%', borderRadius: 12, padding: 10, marginBottom: 8 },
  bubbleMine: { backgroundColor: '#4299e1', alignSelf: 'flex-end' },
  bubbleTheirs: { backgroundColor: '#edf2f7', alignSelf: 'flex-start' },
  bubbleTextMine: { color: '#fff', fontSize: 14 },
  bubbleText: { color: '#1a202c', fontSize: 14 },
  attachment: { color: '#4299e1', fontSize: 13, marginTop: 4 },
  timestamp: { fontSize: 10, color: '#a0aec0', marginTop: 4, alignSelf: 'flex-end' },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    alignItems: 'flex-end',
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
    color: '#1a202c',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#4299e1',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnText: { color: '#fff', fontWeight: '600' },
});

export default VetDirectoryScreen;
