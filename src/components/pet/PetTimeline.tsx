import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getPetTimelinePage,
  TIMELINE_PAGE_SIZE,
  type TimelineEntry,
  type TimelineEntryType,
} from '../../services/petTimelineService';
import { formatLocalDate, formatLocalTime } from '../../utils/dateLocale';

export interface PetTimelineProps {
  petId: string;
  onSelectEntry?: (entry: TimelineEntry) => void;
}

interface TimelineRow {
  key: string;
  kind: 'divider' | 'entry';
  label?: string;
  entry?: TimelineEntry;
}

const TYPE_STYLES: Record<TimelineEntryType, { icon: string; color: string; label: string }> = {
  record: { icon: '📋', color: '#1565c0', label: 'Medical record' },
  medication: { icon: '💊', color: '#6a1b9a', label: 'Medication' },
  appointment: { icon: '📅', color: '#ef6c00', label: 'Appointment' },
  weight: { icon: '⚖️', color: '#2e7d32', label: 'Weight log' },
  vaccination: { icon: '💉', color: '#c62828', label: 'Vaccination' },
};

const dayKey = (iso: string): string => iso.slice(0, 10);

const buildRows = (entries: TimelineEntry[]): TimelineRow[] => {
  const rows: TimelineRow[] = [];
  let currentDay: string | null = null;
  for (const entry of entries) {
    const day = dayKey(entry.occurredAt);
    if (day !== currentDay) {
      currentDay = day;
      rows.push({ key: `divider:${day}`, kind: 'divider', label: formatLocalDate(entry.occurredAt) });
    }
    rows.push({ key: entry.id, kind: 'entry', entry });
  }
  return rows;
};

/**
 * Chronological, paginated health timeline for a pet (issue #1376).
 * Entries are grouped under date dividers and each type has its own icon/colour.
 */
export const PetTimeline: React.FC<PetTimelineProps> = ({ petId, onSelectEntry }) => {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getPetTimelinePage(petId, nextPage, TIMELINE_PAGE_SIZE);
        setEntries((previous) =>
          nextPage === 1 ? result.entries : [...previous, ...result.entries],
        );
        setPage(result.page);
        setHasMore(result.hasMore);
      } catch {
        setError('Failed to load timeline.');
      } finally {
        setLoading(false);
      }
    },
    [petId],
  );

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  const rows = useMemo(() => buildRows(entries), [entries]);

  const renderItem = useCallback(
    ({ item }: { item: TimelineRow }) => {
      if (item.kind === 'divider') {
        return (
          <View style={styles.divider} accessible accessibilityRole="header">
            <Text style={styles.dividerText}>{item.label}</Text>
          </View>
        );
      }
      const entry = item.entry as TimelineEntry;
      const typeStyle = TYPE_STYLES[entry.type];
      return (
        <Pressable
          style={styles.row}
          onPress={() => onSelectEntry?.(entry)}
          accessibilityRole="button"
          accessibilityLabel={`${typeStyle.label}: ${entry.title}`}
          accessibilityHint="Opens the entry details"
        >
          <View style={[styles.iconBadge, { backgroundColor: typeStyle.color }]}>
            <Text style={styles.iconText}>{typeStyle.icon}</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{entry.title}</Text>
            {entry.subtitle ? <Text style={styles.rowSubtitle}>{entry.subtitle}</Text> : null}
            <Text style={styles.rowMeta}>
              {typeStyle.label} · {formatLocalTime(entry.occurredAt)}
            </Text>
          </View>
        </Pressable>
      );
    },
    [onSelectEntry],
  );

  if (loading && entries.length === 0) {
    return (
      <View style={styles.state}>
        <ActivityIndicator accessibilityLabel="Loading timeline" />
      </View>
    );
  }

  if (error && entries.length === 0) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.state}>
          <Text style={styles.stateText}>No health events yet.</Text>
        </View>
      }
      ListFooterComponent={
        hasMore ? (
          <Pressable
            style={styles.loadMore}
            onPress={() => void loadPage(page + 1)}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Load more timeline entries"
          >
            <Text style={styles.loadMoreText}>{loading ? 'Loading…' : 'Load more'}</Text>
          </Pressable>
        ) : null
      }
    />
  );
};

const styles = StyleSheet.create({
  list: { paddingBottom: 24 },
  divider: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  dividerText: { fontSize: 12, fontWeight: '700', color: '#555' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconText: { fontSize: 16 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  rowSubtitle: { fontSize: 13, color: '#555', marginTop: 2 },
  rowMeta: { fontSize: 12, color: '#888', marginTop: 4 },
  state: { padding: 24, alignItems: 'center' },
  stateText: { fontSize: 14, color: '#666' },
  loadMore: { padding: 14, alignItems: 'center' },
  loadMoreText: { color: '#4CAF50', fontWeight: '700' },
});

export default PetTimeline;
