import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { motionDuration } from '../theme/motion';
import { StateView } from '../components/StateView';
import { EmptyState } from '../components/EmptyState';
import { SyncBanner } from '../components/SyncBanner';
import {
  PackingCategory,
  PackingItem,
  PackingChecklist,
  useTravelPackingChecklist,
} from '../state/useTravelPackingChecklist';

export interface TravelPackingChecklistScreenProps {
  petId: string;
  tripName?: string;
  tripId?: string;
  onBack?: () => void;
}

const CATEGORY_ORDER: PackingCategory[] = ['food', 'records', 'medication', 'equipment'];

const CATEGORY_LABELS: Record<PackingCategory, string> = {
  food: 'Food',
  records: 'Records',
  medication: 'Medication',
  equipment: 'Equipment',
};

const CATEGORY_DESCRIPTIONS: Record<PackingCategory, string> = {
  food: 'Food, water, bowls, and treats for the trip',
  records: 'Vaccination records, ID tags, and travel documents',
  medication: 'Prescriptions, doses, and first-aid supplies',
  equipment: 'Carriers, leashes, bedding, and travel gear',
};

interface CategorySectionProps {
  category: PackingCategory;
  items: PackingItem[];
  reducedMotion: boolean;
  disabled: boolean;
  onToggle: (itemId: string) => void;
  onRename: (itemId: string, label: string) => void;
  onRemove: (itemId: string) => void;
  onAdd: (category: PackingCategory, label: string) => void;
}

function CategorySection({
  category,
  items,
  reducedMotion,
  disabled,
  onToggle,
  onRename,
  onRemove,
  onAdd,
}: CategorySectionProps) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const categoryLabel = CATEGORY_LABELS[category];
  const checkedCount = items.filter((item) => item.checked).length;

  const handleAdd = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    onAdd(category, trimmed);
    setDraft('');
  }, [category, draft, onAdd]);

  const beginEdit = useCallback((item: PackingItem) => {
    setEditingId(item.id);
    setEditingValue(item.label);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) {
      return;
    }
    const trimmed = editingValue.trim();
    if (trimmed) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
    setEditingValue('');
  }, [editingId, editingValue, onRename]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingValue('');
  }, []);

  return (
    <View
      style={styles.section}
      accessible={false}
      accessibilityRole="header"
      accessibilityLabel={`${categoryLabel} category, ${checkedCount} of ${items.length} packed`}
    >
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {categoryLabel}
        </Text>
        <Text style={styles.sectionProgress}>
          {checkedCount}/{items.length}
        </Text>
      </View>
      <Text style={styles.sectionDescription}>{CATEGORY_DESCRIPTIONS[category]}</Text>

      {items.length === 0 ? (
        <Text style={styles.sectionEmpty}>No items yet. Add one below.</Text>
      ) : (
        items.map((item) => {
          const isEditing = editingId === item.id;
          return (
            <View key={item.id} style={styles.itemRow}>
              {isEditing ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.input}
                    value={editingValue}
                    onChangeText={setEditingValue}
                    onSubmitEditing={commitEdit}
                    accessibilityLabel={`Rename ${categoryLabel} item`}
                    placeholder="Item name"
                    placeholderTextColor="#8A8A8E"
                    autoFocus
                    editable={!disabled}
                    returnKeyType="done"
                  />
                  <Pressable
                    onPress={commitEdit}
                    accessibilityRole="button"
                    accessibilityLabel={`Save renamed ${categoryLabel} item`}
                    style={styles.inlineButton}
                    disabled={disabled}
                  >
                    <Text style={styles.inlineButtonText}>Save</Text>
                  </Pressable>
                  <Pressable
                    onPress={cancelEdit}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel renaming ${categoryLabel} item`}
                    style={styles.inlineButton}
                  >
                    <Text style={styles.inlineButtonText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Pressable
                    onPress={() => onToggle(item.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.checked, disabled }}
                    accessibilityLabel={`${categoryLabel}: ${item.label}, ${
                      item.checked ? 'packed' : 'not packed'
                    }`}
                    style={styles.checkboxRow}
                    disabled={disabled}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        item.checked && styles.checkboxChecked,
                        reducedMotion ? null : styles.checkboxTransition,
                      ]}
                    >
                      {item.checked ? <Text style={styles.checkmark}>✓</Text> : null}
                    </View>
                    <Text
                      style={[styles.itemLabel, item.checked && styles.itemLabelChecked]}
                      numberOfLines={2}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                  <View style={styles.itemActions}>
                    <Pressable
                      onPress={() => beginEdit(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Rename ${categoryLabel} item ${item.label}`}
                      style={styles.inlineButton}
                      disabled={disabled}
                    >
                      <Text style={styles.inlineButtonText}>Rename</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onRemove(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${categoryLabel} item ${item.label}`}
                      style={styles.inlineButton}
                      disabled={disabled}
                    >
                      <Text style={styles.inlineButtonText}>Remove</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          );
        })
      )}

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={handleAdd}
          accessibilityLabel={`Add new ${categoryLabel} item`}
          placeholder={`Add ${categoryLabel.toLowerCase()} item`}
          placeholderTextColor="#8A8A8E"
          editable={!disabled}
          returnKeyType="done"
        />
        <Pressable
          onPress={handleAdd}
          accessibilityRole="button"
          accessibilityLabel={`Add ${categoryLabel} item`}
          accessibilityState={{ disabled: disabled || draft.trim().length === 0 }}
          style={[styles.addButton, (disabled || draft.trim().length === 0) && styles.addButtonDisabled]}
          disabled={disabled || draft.trim().length === 0}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function TravelPackingChecklistScreen({
  petId,
  tripName,
  tripId,
  onBack,
}: TravelPackingChecklistScreenProps) {
  const reducedMotion = useReducedMotion();
  const {
    checklist,
    status,
    error,
    permissionDenied,
    isOffline,
    pendingSync,
    retry,
    toggleItem,
    renameItem,
    removeItem,
    addItem,
  } = useTravelPackingChecklist({ petId, tripId });

  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncement = useRef('');

  const announce = useCallback((message: string) => {
    if (!message || message === lastAnnouncement.current) {
      return;
    }
    lastAnnouncement.current = message;
    setAnnouncement(message);
    AccessibilityInfo.announceForAccessibility?.(message);
  }, []);

  useEffect(() => {
    if (status === 'ready' && checklist) {
      const total = checklist.items.length;
      const packed = checklist.items.filter((item) => item.checked).length;
      announce(`Checklist loaded. ${packed} of ${total} items packed.`);
    }
  }, [status, checklist, announce]);

  const handleToggle = useCallback(
    (itemId: string) => {
      const item = checklist?.items.find((entry) => entry.id === itemId);
      toggleItem(itemId);
      if (item) {
        announce(`${item.label} ${item.checked ? 'unpacked' : 'packed'}`);
      }
    },
    [checklist, toggleItem, announce],
  );

  const handleAdd = useCallback(
    (category: PackingCategory, label: string) => {
      addItem(category, label);
      announce(`Added ${label} to ${CATEGORY_LABELS[category]}`);
    },
    [addItem, announce],
  );

  const handleRename = useCallback(
    (itemId: string, label: string) => {
      renameItem(itemId, label);
      announce(`Renamed item to ${label}`);
    },
    [renameItem, announce],
  );

  const handleRemove = useCallback(
    (itemId: string) => {
      const item = checklist?.items.find((entry) => entry.id === itemId);
      removeItem(itemId);
      if (item) {
        announce(`Removed ${item.label}`);
      }
    },
    [checklist, removeItem, announce],
  );

  const grouped = useMemo(() => {
    const map: Record<PackingCategory, PackingItem[]> = {
      food: [],
      records: [],
      medication: [],
      equipment: [],
    };
    if (checklist) {
      for (const item of checklist.items) {
        if (map[item.category]) {
          map[item.category].push(item);
        }
      }
    }
    return map;
  }, [checklist]);

  const totals = useMemo(() => {
    const items = checklist?.items ?? [];
    const packed = items.filter((item) => item.checked).length;
    return { packed, total: items.length };
  }, [checklist]);

  const headerTitle = tripName ? `${tripName} packing` : 'Travel packing checklist';

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <View style={styles.centered}>
          <ActivityIndicator
            accessibilityLabel="Loading packing checklist"
            color="#0A84FF"
          />
        </View>
      );
    }

    if (permissionDenied) {
      return (
        <StateView
          variant="permission"
          title="Checklist access needed"
          message="You do not have permission to view this pet's packing checklist."
          actionLabel="Go back"
          onAction={onBack}
        />
      );
    }

    if (status === 'error') {
      return (
        <StateView
          variant="error"
          title="Couldn't load checklist"
          message={error || 'Something went wrong while loading your checklist.'}
          actionLabel="Retry"
          onAction={retry}
        />
      );
    }

    if (isOffline && !checklist) {
      return (
        <StateView
          variant="offline"
          title="You're offline"
          message="Connect to the internet to load your packing checklist."
          actionLabel="Retry"
          onAction={retry}
        />
      );
    }

    if (!checklist || checklist.items.length === 0) {
      return (
        <EmptyState
          title="No packing items yet"
          message="Add food, records, medication, and equipment to build your trip checklist."
          actionLabel="Add starter items"
          onAction={() => {
            addItem('food', 'Food and water');
            addItem('records', 'Vaccination records');
            addItem('medication', 'Medications');
            addItem('equipment', 'Leash and carrier');
            announce('Starter items added');
          }}
        />
      );
    }

    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {CATEGORY_ORDER.map((category) => (
          <CategorySection
            key={category}
            category={category}
            items={grouped[category]}
            reducedMotion={reducedMotion}
            disabled={isOffline || pendingSync}
            onToggle={handleToggle}
            onRename={handleRename}
            onRemove={handleRemove}
            onAdd={handleAdd}
          />
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {headerTitle}
        </Text>
        <View style={styles.backButton} />
      </View>

      {checklist ? (
        <View
          style={styles.progressBar}
          accessibilityRole="progressbar"
          accessibilityLabel={`Overall packing progress, ${totals.packed} of ${totals.total} items packed`}
          accessibilityValue={{ min: 0, max: totals.total, now: totals.packed }}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: totals.total > 0 ? `${(totals.packed / totals.total) * 100}%` : '0%',
              },
              reducedMotion ? null : { transitionDuration: motionDuration.standard },
            ]}
          />
        </View>
      ) : null}

      {pendingSync ? <SyncBanner message="Saving checklist changes…" /> : null}
      {isOffline && checklist ? (
        <SyncBanner message="Offline — changes will sync when you reconnect." />
      ) : null}

      <View style={styles.body}>{renderBody()}</View>

      <Text
        style={styles.srOnly}
        accessibilityLiveRegion="polite"
        accessibilityElementsHidden={false}
      >
        {announcement}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  backButton: {
    minWidth: 64,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#0A84FF',
    fontSize: 16,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#34C759',
    borderRadius: 3,
  },
  body: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  sectionProgress: {
    fontSize: 14,
    color: '#8A8A8E',
    fontVariant: ['tabular-nums'],
  },
  sectionDescription: {
    fontSize: 13,
    color: '#8A8A8E',
    marginTop: 2,
    marginBottom: 8,
  },
  sectionEmpty: {
    fontSize: 14,
    color: '#8A8A8E',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  itemRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F2F7',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 44,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#C7C7CC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: '#34C759',
    borderColor: '#34C759',
  },
  checkboxTransition: {
    transitionDuration: motionDuration.fast,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  itemLabel: {
    flex: 1,
    fontSize: 16,
    color: '#1C1C1E',
  },
  itemLabelChecked: {
    color: '#8A8A8E',
    textDecorationLine: 'line-through',
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  inlineButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  inlineButtonText: {
    color: '#0A84FF',
    fontSize: 14,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1C1C1E',
    minHeight: 44,
  },
  addButton: {
    backgroundColor: '#0A84FF',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  addButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});