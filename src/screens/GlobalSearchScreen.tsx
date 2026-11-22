import { NavigationContext } from '@react-navigation/native';
import React, { useState, useCallback, useContext, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useOfflineStatus } from '../components/OfflineIndicator';
import { getAppointments } from '../services/appointmentService';
import { getMedications } from '../services/medicationService';
import { getAllPets } from '../services/petService';
import {
  globalSearch,
  type SearchResultItem,
  type SearchCategory,
} from '../services/searchService';
import {
  getRecentSearches,
  addRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
  filterSuggestions,
  QUICK_ACTIONS,
  type QuickAction,
  getEntityIndex,
  refreshEntityIndex,
  getGroupedSuggestions,
  getSuggestionRoute,
  SUGGESTION_DEBOUNCE_MS,
  type EntityLoaders,
  type EntitySuggestion,
  type SuggestionGroup,
} from '../services/searchSuggestionsService';
import { searchVets } from '../services/vetService';

/**
 * Sources for the local suggestion index (#1389). Each service falls back to
 * its own local cache where it has one; failures keep the cached index.
 */
const ENTITY_LOADERS: EntityLoaders = {
  pet: async () =>
    (await getAllPets()).map((p) => ({
      type: 'pet' as const,
      id: p.id,
      title: p.name,
      subtitle: [p.species, p.breed].filter(Boolean).join(' · '),
    })),
  vet: async () =>
    (await searchVets({})).map((v) => ({
      type: 'vet' as const,
      id: v.id,
      title: v.name,
      subtitle: v.specialty,
    })),
  medication: async () =>
    (await getMedications()).map((m) => ({
      type: 'medication' as const,
      id: m.id,
      title: m.name,
      subtitle: m.dosage,
      params: { petId: m.petId },
    })),
  appointment: async () =>
    (await getAppointments()).map((a) => ({
      type: 'appointment' as const,
      id: a.id,
      title: a.vet?.name ? `Appointment with ${a.vet.name}` : 'Appointment',
      subtitle: [a.date, a.time].filter(Boolean).join(' '),
    })),
};

const CATEGORIES: { key: SearchCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pets', label: 'Pets' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'medical_records', label: 'Medical Records' },
];

interface Props {
  onSelectResult?: (item: SearchResultItem) => void;
  onQuickAction?: (action: string) => void;
  /** Overrides the default navigation when a suggestion is picked. */
  onSelectSuggestion?: (suggestion: EntitySuggestion) => void;
}

const GlobalSearchScreen: React.FC<Props> = ({
  onSelectResult,
  onQuickAction,
  onSelectSuggestion,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('all');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [entityIndex, setEntityIndex] = useState<EntitySuggestion[]>([]);
  const [suggestionGroups, setSuggestionGroups] = useState<SuggestionGroup[]>([]);
  const navigation = useContext(NavigationContext);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isOnline } = useOfflineStatus();

  // Load recents and the local suggestion index on mount; refresh the index
  // in the background so suggestions also work offline (#1389).
  useEffect(() => {
    let cancelled = false;
    getRecentSearches().then(setRecents);
    getEntityIndex().then((index) => {
      if (!cancelled) setEntityIndex(index);
    });
    refreshEntityIndex(ENTITY_LOADERS).then((index) => {
      if (!cancelled) setEntityIndex(index);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const performSearch = useCallback((searchText: string, searchCategory: SearchCategory) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    globalSearch(searchText, searchCategory, undefined, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setResults(res.items);
          setFromCache(res.fromCache);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
  }, []);

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      if (!text.trim()) {
        setResults([]);
        setSuggestions([]);
        setSuggestionGroups([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      // Suggestions (recents + grouped type-ahead) appear after a 300ms debounce.
      debounceTimerRef.current = setTimeout(() => {
        setSuggestions(filterSuggestions(recents, text));
        setSuggestionGroups(getGroupedSuggestions(entityIndex, text));
        performSearch(text, category);
      }, SUGGESTION_DEBOUNCE_MS);
    },
    [category, recents, entityIndex, performSearch],
  );

  const handleCategoryChange = useCallback(
    (newCategory: SearchCategory) => {
      setCategory(newCategory);
      if (query.trim()) {
        performSearch(query, newCategory);
      }
    },
    [query, performSearch],
  );

  const commitSearch = useCallback(async (text: string) => {
    if (!text.trim()) return;
    await addRecentSearch(text);
    const updated = await getRecentSearches();
    setRecents(updated);
    setSuggestions([]);
  }, []);

  const handleSelectSuggestion = useCallback(
    (suggestion: string) => {
      setQuery(suggestion);
      setSuggestions([]);
      performSearch(suggestion, category);
      commitSearch(suggestion);
    },
    [category, commitSearch, performSearch],
  );

  const handleSelectEntity = useCallback(
    (suggestion: EntitySuggestion) => {
      commitSearch(query);
      setSuggestionGroups([]);
      if (onSelectSuggestion) {
        onSelectSuggestion(suggestion);
        return;
      }
      // Navigate straight to the matching entity.
      const { screen, params } = getSuggestionRoute(suggestion);
      (navigation as { navigate?: (s: string, p?: object) => void } | undefined)?.navigate?.(
        screen,
        params,
      );
    },
    [query, commitSearch, onSelectSuggestion, navigation],
  );

  const handleRemoveRecent = useCallback(async (item: string) => {
    const updated = await removeRecentSearch(item);
    setRecents(updated);
    setSuggestions((prev) => prev.filter((s) => s !== item));
  }, []);

  const handleClearAll = useCallback(async () => {
    await clearRecentSearches();
    setRecents([]);
    setSuggestions([]);
  }, []);

  const handleSelectResult = useCallback(
    (item: SearchResultItem) => {
      commitSearch(query);
      onSelectResult?.(item);
    },
    [query, commitSearch, onSelectResult],
  );

  const showSuggestions = query.trim().length > 0 && suggestions.length > 0;
  const showRecents = !query.trim() && recents.length > 0;
  const showQuickActions = !query.trim();
  const showResults = query.trim().length > 0 && !showSuggestions;

  const renderResult = ({ item }: { item: SearchResultItem }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleSelectResult(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.category}`}
    >
      <Text style={styles.resultTitle}>{item.title}</Text>
      {item.subtitle ? <Text style={styles.resultSubtitle}>{item.subtitle}</Text> : null}
      <Text style={styles.resultCategory}>{item.category.replace('_', ' ')}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Offline — showing local results</Text>
        </View>
      )}

      <TextInput
        style={styles.input}
        placeholder="Search pets, records, appointments…"
        value={query}
        onChangeText={handleQueryChange}
        onSubmitEditing={() => commitSearch(query)}
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel="Global search input"
      />

      {/* Inline autocomplete suggestions */}
      {showSuggestions && (
        <View style={styles.suggestionsBox}>
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s}
              style={styles.suggestionRow}
              onPress={() => handleSelectSuggestion(s)}
              accessibilityRole="button"
              accessibilityLabel={`Suggestion: ${s}`}
            >
              <Text style={styles.suggestionIcon}>🔍</Text>
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Type-ahead suggestions grouped by entity type (#1389) */}
      {query.trim().length > 0 && suggestionGroups.length > 0 && (
        <View style={styles.suggestionsBox} accessibilityLabel="Suggestions">
          {suggestionGroups.map((group) => (
            <View key={group.type}>
              <Text style={styles.groupTitle}>
                {group.icon} {group.label}
              </Text>
              {group.items.map((item) => (
                <TouchableOpacity
                  key={`${item.type}:${item.id}`}
                  style={styles.suggestionRow}
                  onPress={() => handleSelectEntity(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${group.label}: ${item.title}`}
                >
                  <Text style={styles.suggestionIcon}>{group.icon}</Text>
                  <View>
                    <Text style={styles.suggestionText}>{item.title}</Text>
                    {item.subtitle ? (
                      <Text style={styles.resultSubtitle}>{item.subtitle}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* Category filter tabs */}
      <View style={styles.tabs}>
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.tab, category === c.key && styles.tabActive]}
            onPress={() => handleCategoryChange(c.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: category === c.key }}
          >
            <Text style={[styles.tabText, category === c.key && styles.tabTextActive]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent searches */}
      {showRecents && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent searches</Text>
            <TouchableOpacity
              onPress={handleClearAll}
              accessibilityRole="button"
              accessibilityLabel="Clear all recent searches"
            >
              <Text style={styles.clearAll}>Clear all</Text>
            </TouchableOpacity>
          </View>
          {recents.map((r) => (
            <View key={r} style={styles.recentRow}>
              <TouchableOpacity
                style={styles.recentLabel}
                onPress={() => handleSelectSuggestion(r)}
                accessibilityRole="button"
                accessibilityLabel={`Recent search: ${r}`}
              >
                <Text style={styles.recentIcon}>🕐</Text>
                <Text style={styles.recentText}>{r}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleRemoveRecent(r)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${r} from recent searches`}
              >
                <Text style={styles.removeIcon}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Quick actions */}
      {showQuickActions && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick actions</Text>
          <View style={styles.quickActionsGrid}>
            {QUICK_ACTIONS.map((qa: QuickAction) => (
              <TouchableOpacity
                key={qa.id}
                style={styles.quickAction}
                onPress={() => onQuickAction?.(qa.action)}
                accessibilityRole="button"
                accessibilityLabel={qa.label}
              >
                <Text style={styles.quickActionIcon}>{qa.icon}</Text>
                <Text style={styles.quickActionLabel}>{qa.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {loading && <ActivityIndicator style={styles.loader} />}

      {fromCache && !loading && results.length > 0 && (
        <Text style={styles.cacheNote}>Local results — sync when online for full results</Text>
      )}

      {showResults && (
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.category}:${item.id}`}
          renderItem={renderResult}
          ListEmptyComponent={
            !loading ? <Text style={styles.emptyText}>No results for "{query}"</Text> : null
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 12 },
  offlineBanner: { backgroundColor: '#f0ad4e', padding: 8, borderRadius: 6, marginBottom: 8 },
  offlineText: { color: '#fff', textAlign: 'center', fontSize: 12 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 4,
  },
  suggestionsBox: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  suggestionIcon: { fontSize: 14, marginRight: 8, color: '#999' },
  suggestionText: { fontSize: 15, color: '#333' },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  tabs: { flexDirection: 'row', marginBottom: 8 },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 6,
    backgroundColor: '#f0f0f0',
  },
  tabActive: { backgroundColor: '#4a90e2' },
  tabText: { fontSize: 13, color: '#555' },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  section: { marginBottom: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  clearAll: { fontSize: 13, color: '#4a90e2' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  recentLabel: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  recentIcon: { fontSize: 14, marginRight: 10, color: '#bbb' },
  recentText: { fontSize: 15, color: '#333' },
  removeIcon: { fontSize: 14, color: '#ccc', paddingHorizontal: 8 },
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickAction: {
    width: '30%',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f5f7ff',
    borderWidth: 1,
    borderColor: '#e8ecff',
  },
  quickActionIcon: { fontSize: 22, marginBottom: 4 },
  quickActionLabel: { fontSize: 11, color: '#555', textAlign: 'center' },
  loader: { marginVertical: 16 },
  cacheNote: { fontSize: 11, color: '#999', marginBottom: 4, textAlign: 'center' },
  resultItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  resultTitle: { fontSize: 15, fontWeight: '600' },
  resultSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  resultCategory: { fontSize: 11, color: '#4a90e2', marginTop: 2, textTransform: 'capitalize' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 24 },
});

export default GlobalSearchScreen;
