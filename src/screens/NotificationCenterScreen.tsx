/**
 * NotificationCenterScreen
 *
 * Aggregated notification inbox with:
 *  - Category filter tabs
 *  - Bulk mark-as-read / delete
 *  - Pull-to-refresh
 *  - Empty / loading / error states
 *  - Deep-link navigation on item press
 */
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import NotificationItem, { resolveNavPayload } from '../components/NotificationItem';
import { SkeletonCard } from '../components/SkeletonCard';
import { useMinimumLoadingTime } from '../hooks/useMinimumLoadingTime';
import {
  deleteAll,
  deleteMany,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  markManyAsRead,
  type AppNotification,
  type NotificationFilter,
} from '../services/notificationStore';

// ─── State ────────────────────────────────────────────────────────────────────

type Filter = NotificationFilter;

interface State {
  notifications: AppNotification[];
  filter: Filter;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  selected: Set<string>;
  unreadCount: number;
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; notifications: AppNotification[]; unreadCount: number }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'REFRESH_START' }
  | { type: 'SET_FILTER'; filter: Filter }
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECT_ALL' }
  | { type: 'MARK_READ'; ids: string[] }
  | { type: 'DELETE'; ids: string[] }
  | { type: 'SET_UNREAD'; count: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'REFRESH_START':
      return { ...state, refreshing: true, error: null };
    case 'LOAD_SUCCESS':
      return {
        ...state,
        loading: false,
        refreshing: false,
        notifications: action.notifications,
        unreadCount: action.unreadCount,
        error: null,
      };
    case 'LOAD_ERROR':
      return { ...state, loading: false, refreshing: false, error: action.error };
    case 'SET_FILTER':
      return { ...state, filter: action.filter, selected: new Set(), loading: true };
    case 'TOGGLE_SELECT': {
      const next = new Set(state.selected);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selected: next };
    }
    case 'CLEAR_SELECTION':
      return { ...state, selected: new Set() };
    case 'SELECT_ALL':
      return { ...state, selected: new Set(state.notifications.map((n) => n.id)) };
    case 'MARK_READ': {
      const ids = new Set(action.ids);
      return {
        ...state,
        selected: new Set(),
        notifications: state.notifications.map((n) => (ids.has(n.id) ? { ...n, isRead: true } : n)),
        unreadCount: Math.max(
          0,
          state.unreadCount - state.notifications.filter((n) => ids.has(n.id) && !n.isRead).length,
        ),
      };
    }
    case 'DELETE': {
      const ids = new Set(action.ids);
      const removed = state.notifications.filter((n) => ids.has(n.id));
      const removedUnread = removed.filter((n) => !n.isRead).length;
      return {
        ...state,
        selected: new Set(),
        notifications: state.notifications.filter((n) => !ids.has(n.id)),
        unreadCount: Math.max(0, state.unreadCount - removedUnread),
      };
    }
    case 'SET_UNREAD':
      return { ...state, unreadCount: action.count };
    default:
      return state;
  }
}

const INITIAL_STATE: State = {
  notifications: [],
  filter: 'all',
  loading: true,
  refreshing: false,
  error: null,
  selected: new Set(),
  unreadCount: 0,
};

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'medication', label: '💊 Meds' },
  { key: 'appointment', label: '📅 Appts' },
  { key: 'sos', label: '🆘 SOS' },
  { key: 'system', label: '🔔 System' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationCenterScreen() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const navigation = useNavigation<{ navigate: (screen: string, params?: unknown) => void }>();
  const isMounted = useRef(true);

  // Enforce minimum 300ms display for skeleton
  const displayLoading = useMinimumLoadingTime(state.loading && !state.refreshing, {
    minLoadingTime: 300,
  });

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(
    async (isRefresh = false) => {
      dispatch({ type: isRefresh ? 'REFRESH_START' : 'LOAD_START' });
      try {
        const [notifications, unreadCount] = await Promise.all([
          getNotifications(state.filter),
          getUnreadCount(),
        ]);
        if (isMounted.current) {
          dispatch({ type: 'LOAD_SUCCESS', notifications, unreadCount });
        }
      } catch (err) {
        if (isMounted.current) {
          dispatch({
            type: 'LOAD_ERROR',
            error: err instanceof Error ? err.message : 'Failed to load notifications',
          });
        }
      }
    },
    [state.filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleFilterChange = useCallback((filter: Filter) => {
    dispatch({ type: 'SET_FILTER', filter });
  }, []);

  const handleItemPress = useCallback(
    async (notification: AppNotification) => {
      // Mark as read
      if (!notification.isRead) {
        dispatch({ type: 'MARK_READ', ids: [notification.id] });
        await markAsRead(notification.id).catch(() => {});
      }

      // Navigate if valid payload
      const target = resolveNavPayload(notification);
      if (target) {
        try {
          navigation.navigate(target.screen, target.params);
        } catch {
          // Navigation target may not be reachable from this context; ignore
        }
      }
    },
    [navigation],
  );

  const handleItemLongPress = useCallback((notification: AppNotification) => {
    dispatch({ type: 'TOGGLE_SELECT', id: notification.id });
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    const ids = state.notifications.filter((n) => !n.isRead).map((n) => n.id);
    if (ids.length === 0) return;
    dispatch({ type: 'MARK_READ', ids });
    await markAllAsRead(state.filter).catch(() => {});
  }, [state.notifications, state.filter]);

  const handleMarkSelectedRead = useCallback(async () => {
    const ids = [...state.selected];
    dispatch({ type: 'MARK_READ', ids });
    await markManyAsRead(ids).catch(() => {});
  }, [state.selected]);

  const handleDeleteSelected = useCallback(() => {
    const ids = [...state.selected];
    Alert.alert(
      'Delete notifications',
      `Delete ${ids.length} notification${ids.length !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            dispatch({ type: 'DELETE', ids });
            await deleteMany(ids).catch(() => {});
          },
        },
      ],
    );
  }, [state.selected]);

  const handleDeleteAll = useCallback(() => {
    Alert.alert('Clear all', 'Delete all notifications in this view?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: async () => {
          const ids = state.notifications.map((n) => n.id);
          dispatch({ type: 'DELETE', ids });
          await deleteAll(state.filter).catch(() => {});
        },
      },
    ]);
  }, [state.notifications, state.filter]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => (
      <NotificationItem
        notification={item}
        onPress={handleItemPress}
        onLongPress={handleItemLongPress}
        style={state.selected.has(item.id) ? styles.selectedItem : undefined}
        testID={`notification-item-${item.id}`}
      />
    ),
    [handleItemPress, handleItemLongPress, state.selected],
  );

  const keyExtractor = useCallback((item: AppNotification) => item.id, []);

  const hasSelection = state.selected.size > 0;
  const hasUnread = state.notifications.some((n) => !n.isRead);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container} testID="notification-center-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Notifications
          {state.unreadCount > 0 ? ` (${state.unreadCount})` : ''}
        </Text>
        <View style={styles.headerActions}>
          {hasUnread && !hasSelection && (
            <TouchableOpacity
              onPress={handleMarkAllRead}
              accessibilityLabel="Mark all as read"
              testID="mark-all-read-btn"
            >
              <Text style={styles.actionText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          {state.notifications.length > 0 && !hasSelection && (
            <TouchableOpacity
              onPress={handleDeleteAll}
              accessibilityLabel="Delete all notifications"
              testID="delete-all-btn"
              style={styles.actionSpacer}
            >
              <Text style={[styles.actionText, styles.destructiveText]}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Bulk action bar */}
      {hasSelection && (
        <View style={styles.bulkBar} testID="bulk-action-bar">
          <Text style={styles.bulkCount}>{state.selected.size} selected</Text>
          <View style={styles.bulkActions}>
            <TouchableOpacity
              onPress={handleMarkSelectedRead}
              accessibilityLabel="Mark selected as read"
              testID="bulk-mark-read-btn"
            >
              <Text style={styles.actionText}>Mark read</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDeleteSelected}
              accessibilityLabel="Delete selected notifications"
              testID="bulk-delete-btn"
              style={styles.actionSpacer}
            >
              <Text style={[styles.actionText, styles.destructiveText]}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => dispatch({ type: 'CLEAR_SELECTION' })}
              accessibilityLabel="Cancel selection"
              testID="cancel-selection-btn"
              style={styles.actionSpacer}
            >
              <Text style={styles.actionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Filter tabs */}
      <View style={styles.filterRow} accessibilityRole="tablist">
        {FILTERS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            onPress={() => handleFilterChange(key)}
            style={[styles.filterTab, state.filter === key && styles.filterTabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: state.filter === key }}
            accessibilityLabel={`Filter by ${label}`}
            testID={`filter-tab-${key}`}
          >
            <Text style={[styles.filterLabel, state.filter === key && styles.filterLabelActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {displayLoading ? (
        <View style={styles.loadingContainer} testID="loading-indicator">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonCard key={`skeleton-${index}`} />
          ))}
        </View>
      ) : state.error ? (
        <View style={styles.centered} testID="error-state">
          <Text style={styles.errorText}>{state.error}</Text>
          <TouchableOpacity onPress={() => load()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={state.notifications}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          refreshControl={
            <RefreshControl
              refreshing={state.refreshing}
              onRefresh={() => load(true)}
              tintColor="#4CAF50"
            />
          }
          ListEmptyComponent={
            <View style={styles.centered} testID="empty-state">
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyTitle}>No notifications</Text>
              <Text style={styles.emptyBody}>
                {state.filter === 'all'
                  ? "You're all caught up!"
                  : `No ${state.filter} notifications.`}
              </Text>
            </View>
          }
          contentContainerStyle={
            state.notifications.length === 0 ? styles.emptyContainer : undefined
          }
          removeClippedSubviews
          maxToRenderPerBatch={20}
          windowSize={10}
          testID="notification-list"
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D5DB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionText: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '500',
  },
  destructiveText: {
    color: '#EF4444',
  },
  actionSpacer: {
    marginLeft: 16,
  },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#EFF6FF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#BFDBFE',
  },
  bulkCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D4ED8',
  },
  bulkActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D5DB',
    paddingHorizontal: 8,
  },
  filterTab: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginRight: 4,
  },
  filterTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#4CAF50',
  },
  filterLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  filterLabelActive: {
    color: '#4CAF50',
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingContainer: {
    flex: 1,
    padding: 16,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  selectedItem: {
    backgroundColor: '#DBEAFE',
  },
});
