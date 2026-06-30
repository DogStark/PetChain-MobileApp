import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { SkeletonCard } from '../components/SkeletonCard';
import { getVetReviews, submitVetReview, voteVetReview, type VetReview } from '../services/reviewService';
import { useMinimumLoadingTime } from '../hooks/useMinimumLoadingTime';
import mapService from '../services/mapService';
import {
  getMessages,
  getVetProfile,
  searchVets,
  sendMessage,
  type VetMessage,
  type VetProfile,
} from '../services/vetService';

// ─── Constants ────────────────────────────────────────────────────────────────

const RADIUS_MIN = 1;
const RADIUS_MAX = 50;
const DEBOUNCE_MS = 300;

const SPECIALTY_OPTIONS = [
  'General',
  'Dermatology',
  'Cardiology',
  'Oncology',
  'Surgery',
  'Dentistry',
  'Neurology',
  'Ophthalmology',
];

type Screen = 'directory' | 'profile' | 'chat';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── RadiusSlider ─────────────────────────────────────────────────────────────

interface RadiusSliderProps {
  value: number;
  onChange: (v: number) => void;
}

const RadiusSlider: React.FC<RadiusSliderProps> = ({ value, onChange }) => {
  const trackWidth = useRef(0);
  const ratio = (value - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const x = e.nativeEvent.locationX;
        const r = Math.max(0, Math.min(1, x / (trackWidth.current || 1)));
        onChange(Math.round(RADIUS_MIN + r * (RADIUS_MAX - RADIUS_MIN)));
      },
      onPanResponderMove: (e) => {
        const x = e.nativeEvent.locationX;
        const r = Math.max(0, Math.min(1, x / (trackWidth.current || 1)));
        onChange(Math.round(RADIUS_MIN + r * (RADIUS_MAX - RADIUS_MIN)));
      },
    }),
  ).current;

  return (
    <View style={sliderStyles.wrapper}>
      <View
        style={sliderStyles.track}
        onLayout={(e) => {
          trackWidth.current = e.nativeEvent.layout.width;
        }}
        {...panResponder.panHandlers}
      >
        <View style={[sliderStyles.fill, { width: `${ratio * 100}%` }]} />
        <View style={[sliderStyles.thumb, { left: `${ratio * 100}%` }]} />
      </View>
      <View style={sliderStyles.labels}>
        <Text style={sliderStyles.labelText}>{RADIUS_MIN} km</Text>
        <Text style={sliderStyles.labelText}>{RADIUS_MAX} km</Text>
      </View>
    </View>
  );
};

const sliderStyles = StyleSheet.create({
  wrapper: { marginVertical: 8 },
  track: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  fill: { height: 6, backgroundColor: '#4299e1', borderRadius: 3 },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#4299e1',
    top: -7,
    marginLeft: -10,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 8,
  },
  labelText: { fontSize: 11, color: '#718096' },
});

// ─── Component ────────────────────────────────────────────────────────────────

const VetDirectoryScreen: React.FC = () => {
  const { colors } = useTheme();
  const { show: showToast } = useToast();

  const [screen, setScreen] = useState<Screen>('directory');
  const [vets, setVets] = useState<VetProfile[]>([]);
  const [selectedVet, setSelectedVet] = useState<VetProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const displayLoading = useMinimumLoadingTime(loading, { minLoadingTime: 300 });

  // Location
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  // Filters
  const [radius, setRadius] = useState(25);
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Draft filter state (inside drawer, not applied until confirmed)
  const [draftRadius, setDraftRadius] = useState(25);
  const [draftSpecialties, setDraftSpecialties] = useState<string[]>([]);
  const [draftAvailableOnly, setDraftAvailableOnly] = useState(false);

  // Reviews
  const [reviews, setReviews] = useState<VetReview[]>([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Chat
  const [messages, setMessages] = useState<VetMessage[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Location ───────────────────────────────────────────────────────────────

  const requestLocation = useCallback(async () => {
    try {
      const granted = await mapService.requestLocationPermission();
      if (!granted) {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);
      const loc = await mapService.getCurrentLocation();
      setUserLat(loc.latitude);
      setUserLng(loc.longitude);
    } catch {
      setLocationDenied(true);
    }
  }, []);

  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  // ── Search ─────────────────────────────────────────────────────────────────

  const doSearch = useCallback(
    async (
      lat: number | null,
      lng: number | null,
      r: number,
      specialties: string[],
      availOnly: boolean,
      isRefresh = false,
    ) => {
      const hadData = vets.length > 0;
      setLoading(true);
      try {
        const specialtyParam = specialties.length === 1 ? specialties[0] : undefined;
        const results = await searchVets({
          lat: lat ?? undefined,
          lng: lng ?? undefined,
          radius: r,
          specialty: specialtyParam,
          available: availOnly || undefined,
        });

        // Attach distance client-side and sort
        const withDist = results.map((v) => {
          if (lat !== null && lng !== null && v.lat && v.lng) {
            return { ...v, distance: haversineKm(lat, lng, v.lat, v.lng) };
          }
          return v;
        });

        // Client-side multi-specialty filter when more than one selected
        const filtered =
          specialties.length > 1
            ? withDist.filter((v) =>
                specialties.some((s) => v.specialty.toLowerCase().includes(s.toLowerCase())),
              )
            : withDist;

        const sorted =
          lat !== null
            ? [...filtered].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
            : [...filtered].sort((a, b) => a.name.localeCompare(b.name));

        setVets(sorted);
      } catch {
        // A pull-to-refresh on an already-populated list: keep the list,
        // toast instead of an intrusive blocking alert.
        if (isRefresh && hadData) {
          showToast("Couldn't refresh — showing cached data", { variant: 'error' });
        } else {
          Alert.alert('Error', 'Failed to search vets');
        }
      } finally {
        setLoading(false);
      }
    },
    [vets.length, showToast],
  );

  // Debounced re-search when filters change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(userLat, userLng, radius, selectedSpecialties, availableOnly);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLat, userLng, radius, selectedSpecialties, availableOnly]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await doSearch(userLat, userLng, radius, selectedSpecialties, availableOnly, true);
    setIsRefreshing(false);
  }, [doSearch, userLat, userLng, radius, selectedSpecialties, availableOnly]);

  // ── Filter drawer ──────────────────────────────────────────────────────────

  const openDrawer = () => {
    setDraftRadius(radius);
    setDraftSpecialties(selectedSpecialties);
    setDraftAvailableOnly(availableOnly);
    setFilterDrawerOpen(true);
  };

  const applyFilters = () => {
    setRadius(draftRadius);
    setSelectedSpecialties(draftSpecialties);
    setAvailableOnly(draftAvailableOnly);
    setFilterDrawerOpen(false);
  };

  const toggleDraftSpecialty = (s: string) => {
    setDraftSpecialties((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (radius !== 25) n++;
    if (selectedSpecialties.length) n++;
    if (availableOnly) n++;
    return n;
  }, [radius, selectedSpecialties, availableOnly]);

  // ── Profile / Chat ─────────────────────────────────────────────────────────

  const openProfile = useCallback(async (vet: VetProfile) => {
    try {
      const profile = await getVetProfile(vet.id);
      setSelectedVet(profile);
      setScreen('profile');
      try {
        const fetchedReviews = await getVetReviews(vet.id, 1);
        setReviews(fetchedReviews);
      } catch (err) {
        console.warn('Failed to load reviews', err);
      }
    } catch {
      Alert.alert('Error', 'Failed to load vet profile');
    }
  }, []);

  const handleSubmitReview = async () => {
    if (!selectedVet) return;
    if (reviewText.trim().length === 0) {
      Alert.alert('Error', 'Please enter a review text.');
      return;
    }
    setSubmittingReview(true);
    try {
      const newReview = await submitVetReview(selectedVet.id, 'user123', reviewRating, reviewText.trim());
      if (newReview.status === 'pending_moderation') {
        Alert.alert('Under Review', 'Your review contains flagged words and is pending manual moderation.');
      } else {
        setReviews([newReview, ...reviews]);
      }
      setReviewText('');
      setReviewRating(5);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to submit review. You must have a verified appointment.');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleVote = async (reviewId: string, isHelpful: boolean) => {
    try {
      const updated = await voteVetReview(reviewId, isHelpful);
      setReviews((prev) => prev.map((r) => (r.id === reviewId ? updated : r)));
    } catch (e) {
      Alert.alert('Error', 'Failed to submit vote.');
    }
  };

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

  // ── Directory screen ───────────────────────────────────────────────────────

  if (screen === 'directory') {
    return (
      <View style={styles.container}>
        {/* Location denied banner */}
        {locationDenied && (
          <TouchableOpacity
            style={styles.locationBanner}
            onPress={() => void requestLocation()}
            accessibilityLabel="Enable location for nearest results"
          >
            <Text style={styles.locationBannerText}>
              📍 Enable location for nearest results — tap to retry
            </Text>
          </TouchableOpacity>
        )}

        {/* Header row */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Vet Directory</Text>
          <TouchableOpacity
            style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
            onPress={openDrawer}
            accessibilityLabel="Open filter drawer"
          >
            <Text
              style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextActive]}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Sort / status bar */}
        <Text style={styles.sortLabel}>
          {userLat !== null ? `Sorted by distance · ${radius} km radius` : 'Sorted alphabetically'}
          {selectedSpecialties.length > 0 ? ` · ${selectedSpecialties.join(', ')}` : ''}
          {availableOnly ? ' · Available only' : ''}
        </Text>

        {displayLoading ? (
          <View style={styles.list}>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={`sk-${i}`} />
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
                  </Text>
                  {item.distance !== undefined && (
                    <Text style={styles.distanceText}>📍 {item.distance.toFixed(1)} km away</Text>
                  )}
                </View>
                <View style={[styles.badge, item.available ? styles.badgeGreen : styles.badgeGray]}>
                  <Text style={styles.badgeText}>{item.available ? 'Available' : 'Busy'}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No vets found.</Text>}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => void handleRefresh()}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
          />
        )}

        {/* Filter drawer modal */}
        <Modal
          visible={filterDrawerOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setFilterDrawerOpen(false)}
        >
          <View style={styles.drawerOverlay}>
            <View style={styles.drawer}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>Filters</Text>
                <TouchableOpacity onPress={() => setFilterDrawerOpen(false)}>
                  <Text style={styles.drawerClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.drawerBody}>
                {/* Radius */}
                <Text style={styles.drawerLabel}>Distance radius: {draftRadius} km</Text>
                <RadiusSlider value={draftRadius} onChange={setDraftRadius} />

                {/* Specialty multi-select */}
                <Text style={styles.drawerLabel}>Specialty</Text>
                <View style={styles.specialtyGrid}>
                  {SPECIALTY_OPTIONS.map((s) => {
                    const active = draftSpecialties.includes(s);
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.specialtyChip, active && styles.specialtyChipActive]}
                        onPress={() => toggleDraftSpecialty(s)}
                        accessibilityLabel={`Toggle ${s} specialty`}
                        accessibilityState={{ selected: active }}
                      >
                        <Text
                          style={[
                            styles.specialtyChipText,
                            active && styles.specialtyChipTextActive,
                          ]}
                        >
                          {s}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Available only */}
                <TouchableOpacity
                  style={styles.drawerToggleRow}
                  onPress={() => setDraftAvailableOnly((v) => !v)}
                  accessibilityLabel="Toggle accepts new patients"
                >
                  <Text style={styles.drawerToggleLabel}>Accepts new patients</Text>
                  <View style={[styles.togglePill, draftAvailableOnly && styles.togglePillActive]}>
                    <View
                      style={[styles.toggleDot, draftAvailableOnly && styles.toggleDotActive]}
                    />
                  </View>
                </TouchableOpacity>
              </ScrollView>

              <View style={styles.drawerFooter}>
                <TouchableOpacity
                  style={styles.drawerResetBtn}
                  onPress={() => {
                    setDraftRadius(25);
                    setDraftSpecialties([]);
                    setDraftAvailableOnly(false);
                  }}
                >
                  <Text style={styles.drawerResetText}>Reset</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.drawerApplyBtn} onPress={applyFilters}>
                  <Text style={styles.drawerApplyText}>Apply Filters</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ── Profile screen ─────────────────────────────────────────────────────────

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
        {selectedVet.distance !== undefined && (
          <>
            <Text style={styles.label}>Distance</Text>
            <Text style={styles.value}>📍 {selectedVet.distance.toFixed(1)} km away</Text>
          </>
        )}
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

        <View style={styles.reviewsSection}>
          <Text style={styles.reviewsTitle}>Reviews</Text>
          
          <View style={styles.reviewForm}>
            <Text style={styles.label}>Leave a Review</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setReviewRating(star)}>
                  <Ionicons name={star <= reviewRating ? 'star' : 'star-outline'} size={28} color="#ecc94b" />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.reviewInput}
              placeholder="Share your experience (max 500 chars)"
              value={reviewText}
              onChangeText={setReviewText}
              maxLength={500}
              multiline
            />
            <TouchableOpacity style={styles.submitReviewBtn} onPress={handleSubmitReview} disabled={submittingReview}>
              <Text style={styles.submitReviewText}>{submittingReview ? 'Submitting...' : 'Submit Review'}</Text>
            </TouchableOpacity>
          </View>

          {reviews.map((r) => (
            <View key={r.id} style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <View style={styles.starsRowSmall}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Ionicons key={star} name={star <= r.rating ? 'star' : 'star-outline'} size={14} color="#ecc94b" />
                  ))}
                </View>
                <Text style={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={styles.reviewBody}>{r.text}</Text>
              <View style={styles.voteRow}>
                <TouchableOpacity style={styles.voteBtn} onPress={() => handleVote(r.id, true)}>
                  <Ionicons name="thumbs-up-outline" size={16} color="#718096" />
                  <Text style={styles.voteText}>Helpful ({r.helpful_votes})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.voteBtn} onPress={() => handleVote(r.id, false)}>
                  <Ionicons name="thumbs-down-outline" size={16} color="#718096" />
                  <Text style={styles.voteText}>Not Helpful ({r.not_helpful_votes})</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {reviews.length === 0 && <Text style={styles.empty}>No reviews yet.</Text>}
        </View>
      </ScrollView>
    );
  }

  // ── Chat screen ────────────────────────────────────────────────────────────

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
          <View style={styles.chatList}>
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={`chat-skeleton-${index}`} height={64} lines={2} />
            ))}
          </View>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Location banner
  locationBanner: {
    backgroundColor: '#EBF8FF',
    borderBottomWidth: 1,
    borderBottomColor: '#BEE3F8',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  locationBannerText: { fontSize: 13, color: '#2B6CB0', fontWeight: '500' },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a202c' },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    backgroundColor: '#F7FAFC',
  },
  filterBtnActive: { backgroundColor: '#4299e1', borderColor: '#4299e1' },
  filterBtnText: { fontSize: 13, color: '#4A5568', fontWeight: '600' },
  filterBtnTextActive: { color: '#fff' },
  sortLabel: { fontSize: 12, color: '#718096', paddingHorizontal: 16, paddingBottom: 8 },

  // List
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
  distanceText: { fontSize: 13, color: '#4299e1', fontWeight: '600', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeGreen: { backgroundColor: '#c6f6d5' },
  badgeGray: { backgroundColor: '#e2e8f0' },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#2d3748' },
  empty: { textAlign: 'center', color: '#718096', marginTop: 40 },

  // Filter drawer
  drawerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  drawer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  drawerTitle: { fontSize: 18, fontWeight: '700', color: '#1a202c' },
  drawerClose: { fontSize: 20, color: '#718096' },
  drawerBody: { padding: 20, paddingBottom: 8 },
  drawerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 8,
    marginTop: 12,
  },

  // Specialty chips
  specialtyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  specialtyChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    backgroundColor: '#F7FAFC',
  },
  specialtyChipActive: { backgroundColor: '#4299e1', borderColor: '#4299e1' },
  specialtyChipText: { fontSize: 13, color: '#4A5568' },
  specialtyChipTextActive: { color: '#fff', fontWeight: '600' },

  // Toggle row
  drawerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    marginTop: 8,
  },
  drawerToggleLabel: { fontSize: 15, color: '#1a202c' },
  togglePill: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#CBD5E0',
    justifyContent: 'center',
    padding: 2,
  },
  togglePillActive: { backgroundColor: '#4299e1' },
  toggleDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  toggleDotActive: { alignSelf: 'flex-end' },

  // Drawer footer
  drawerFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
  },
  drawerResetBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    alignItems: 'center',
  },
  drawerResetText: { fontSize: 15, color: '#4A5568', fontWeight: '600' },
  drawerApplyBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#4299e1',
    alignItems: 'center',
  },
  drawerApplyText: { fontSize: 15, color: '#fff', fontWeight: '700' },

  // Profile
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
  searchBtn: {
    backgroundColor: '#4299e1',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  // Chat
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

  // Reviews
  reviewsSection: { marginTop: 32, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 16, paddingBottom: 40 },
  reviewsTitle: { fontSize: 18, fontWeight: '700', color: '#1a202c', marginBottom: 16 },
  reviewForm: { backgroundColor: '#f7fafc', padding: 16, borderRadius: 8, marginBottom: 24 },
  starsRow: { flexDirection: 'row', marginBottom: 12, gap: 4, marginTop: 8 },
  starsRowSmall: { flexDirection: 'row', gap: 2 },
  reviewInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: 'top', marginBottom: 12 },
  submitReviewBtn: { backgroundColor: '#4299e1', padding: 12, borderRadius: 8, alignItems: 'center' },
  submitReviewText: { color: '#fff', fontWeight: '600' },
  reviewCard: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#edf2f7', backgroundColor: '#fff' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  reviewDate: { fontSize: 12, color: '#a0aec0' },
  reviewBody: { fontSize: 14, color: '#4a5568', marginBottom: 12, lineHeight: 20 },
  voteRow: { flexDirection: 'row', gap: 16 },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  voteText: { fontSize: 13, color: '#718096' },
});

// suppress unused wsRef warning — kept for future WebSocket integration
void wsRef;

export default VetDirectoryScreen;
