import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PetRecord } from '../../types/pet';

export interface PetRecordsListProps {
  records: PetRecord[];
  loading?: boolean;
  error?: string | null;
  onSelectRecord?: (record: PetRecord) => void;
  onOpenRecordActions?: (record: PetRecord) => void;
}

const formatRecordDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const recordAccessibilityLabel = (record: PetRecord): string => {
  const parts = [record.title];
  if (record.date) {
    parts.push(formatRecordDate(record.date));
  }
  if (record.summary) {
    parts.push(record.summary);
  }
  return parts.join(', ');
};

/**
 * Records section of the pet profile.
 *
 * Accessibility contract (issue #1059):
 * - Traversal order is identity -> health summary -> records -> actions, so this
 *   list is rendered after the identity/health blocks and exposes a single
 *   accessible container with a stable label.
 * - Loading, empty, and error states are announced exactly once via
 *   AccessibilityInfo.announceForAccessibility.
 * - Decorative imagery is hidden from the accessibility tree.
 * - Record rows expose a text equivalent; the action menu button carries an
 *   explicit label/hint instead of relying on the icon.
 */
export const PetRecordsList: React.FC<PetRecordsListProps> = ({
  records,
  loading = false,
  error = null,
  onSelectRecord,
  onOpenRecordActions,
}) => {
  const lastAnnouncementRef = useRef<string | null>(null);

  const announceOnce = useCallback((key: string, message: string) => {
    if (lastAnnouncementRef.current === key) {
      return;
    }
    lastAnnouncementRef.current = key;
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  useEffect(() => {
    if (loading) {
      announceOnce('loading', 'Loading pet records');
      return;
    }
    if (error) {
      announceOnce('error', `Could not load pet records. ${error}`);
      return;
    }
    if (records.length === 0) {
      announceOnce('empty', 'No pet records yet');
      return;
    }
    announceOnce('loaded', `${records.length} pet records loaded`);
  }, [announceOnce, error, loading, records.length]);

  const renderItem = useCallback(
    ({ item }: { item: PetRecord }) => (
      <View
        style={styles.row}
        accessible
        accessibilityRole="button"
        accessibilityLabel={recordAccessibilityLabel(item)}
        accessibilityHint="Opens the record details"
      >
        <Pressable
          style={styles.rowMain}
          onPress={() => onSelectRecord?.(item)}
          accessibilityRole="button"
          accessibilityLabel={recordAccessibilityLabel(item)}
          accessibilityHint="Opens the record details"
        >
          <Text style={styles.rowTitle}>{item.title}</Text>
          {item.date ? (
            <Text style={styles.rowMeta}>{formatRecordDate(item.date)}</Text>
          ) : null}
          {item.summary ? (
            <Text style={styles.rowSummary}>{item.summary}</Text>
          ) : null}
        </Pressable>
        {onOpenRecordActions ? (
          <Pressable
            style={styles.rowActions}
            onPress={() => onOpenRecordActions(item)}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${item.title}`}
            accessibilityHint="Opens the record action menu"
            hitSlop={8}
          >
            <Image
              source={require('../../assets/icons/more.png')}
              style={styles.rowActionsIcon}
              accessible={false}
              importantForAccessibility="no"
              accessibilityElementsHidden
            />
          </Pressable>
        ) : null}
      </View>
    ),
    [onOpenRecordActions, onSelectRecord],
  );

  const keyExtractor = useCallback((item: PetRecord) => item.id, []);

  const listHeader = useMemo(
    () => (
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Records
      </Text>
    ),
    [],
  );

  if (loading) {
    return (
      <View
        style={styles.stateContainer}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading pet records"
      >
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading records…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={styles.stateContainer}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`Could not load pet records. ${error}`}
      >
        <Text style={styles.stateText}>{error}</Text>
      </View>
    );
  }

  if (records.length === 0) {
    return (
      <View
        style={styles.stateContainer}
        accessible
        accessibilityRole="text"
        accessibilityLabel="No pet records yet"
      >
        <Text style={styles.stateText}>No records yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} accessible={false}>
      <FlatList
        data={records}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        accessibilityLabel="Pet records"
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  rowMeta: {
    fontSize: 13,
    color: '#666666',
    marginTop: 2,
  },
  rowSummary: {
    fontSize: 14,
    color: '#333333',
    marginTop: 4,
  },
  rowActions: {
    padding: 8,
  },
  rowActionsIcon: {
    width: 20,
    height: 20,
  },
  stateContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  stateText: {
    fontSize: 14,
    color: '#666666',
    marginTop: 8,
  },
});

export default PetRecordsList;
