/**
 * notificationsSlice
 *
 * Redux Toolkit slice for in-app notification state management.
 *
 * State shape:
 *   notifications  - ordered list of all in-app notifications (newest first)
 *   unreadCount    - derived count of unread items; also persisted to AsyncStorage
 *   isLoading      - true while a fetch is in progress
 *
 * Actions:
 *   addNotification    - prepend a new notification and increment unreadCount
 *   markAsRead         - mark a single notification read and decrement unreadCount
 *   markAllAsRead      - mark every notification read and reset unreadCount to 0
 *   removeNotification - delete a notification by id and adjust unreadCount if needed
 *
 * Selectors:
 *   selectAllNotifications  - returns the full notifications array
 *   selectUnreadNotifications - returns only unread notifications
 *   selectUnreadCount       - returns the numeric unread count
 *   selectNotificationsLoading - returns the isLoading flag
 */

import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppNotification } from '../services/notificationStore';

// ─── Persistence key ──────────────────────────────────────────────────────────

const UNREAD_COUNT_KEY = '@petchain_unread_notification_count';

// ─── State ────────────────────────────────────────────────────────────────────

export interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
}

const initialState: NotificationsState = {
  notifications: [],
  unreadCount: 0,
  isLoading: false,
};

// ─── Async thunks ─────────────────────────────────────────────────────────────

/**
 * Persist the unread count to AsyncStorage so it survives app restarts.
 * Called internally after any mutation that changes the count.
 */
export const persistUnreadCount = createAsyncThunk<void, number>(
  'notifications/persistUnreadCount',
  async (count: number) => {
    await AsyncStorage.setItem(UNREAD_COUNT_KEY, String(count));
  },
);

/**
 * Restore the persisted unread count from AsyncStorage on app boot.
 * Dispatch this from your app initialisation logic.
 */
export const loadPersistedUnreadCount = createAsyncThunk<number>(
  'notifications/loadPersistedUnreadCount',
  async () => {
    const stored = await AsyncStorage.getItem(UNREAD_COUNT_KEY);
    return stored !== null ? parseInt(stored, 10) : 0;
  },
);

// ─── Slice ────────────────────────────────────────────────────────────────────

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    /**
     * Prepend a notification to the list.
     * Automatically increments unreadCount if the notification is not already read.
     */
    addNotification(state, action: PayloadAction<AppNotification>) {
      // Guard against duplicates
      const exists = state.notifications.some((n) => n.id === action.payload.id);
      if (!exists) {
        state.notifications.unshift(action.payload);
        if (!action.payload.isRead) {
          state.unreadCount += 1;
        }
      }
    },

    /**
     * Mark a single notification as read by id.
     * Decrements unreadCount if the notification was previously unread.
     */
    markAsRead(state, action: PayloadAction<string>) {
      const notification = state.notifications.find((n) => n.id === action.payload);
      if (notification && !notification.isRead) {
        notification.isRead = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
    },

    /**
     * Mark every notification as read and reset unreadCount to 0.
     */
    markAllAsRead(state) {
      state.notifications.forEach((n) => {
        n.isRead = true;
      });
      state.unreadCount = 0;
    },

    /**
     * Remove a notification by id.
     * Adjusts unreadCount if the removed notification was unread.
     */
    removeNotification(state, action: PayloadAction<string>) {
      const index = state.notifications.findIndex((n) => n.id === action.payload);
      if (index !== -1) {
        const [removed] = state.notifications.splice(index, 1);
        if (!removed.isRead) {
          state.unreadCount = Math.max(0, state.unreadCount - 1);
        }
      }
    },
  },
  extraReducers: (builder) => {
    // loadPersistedUnreadCount
    builder.addCase(loadPersistedUnreadCount.pending, (state) => {
      state.isLoading = true;
    });
    builder.addCase(loadPersistedUnreadCount.fulfilled, (state, action) => {
      state.isLoading = false;
      // Only restore if we have no in-memory data yet (avoids overwriting live data)
      if (state.notifications.length === 0) {
        state.unreadCount = action.payload;
      }
    });
    builder.addCase(loadPersistedUnreadCount.rejected, (state) => {
      state.isLoading = false;
    });

    // persistUnreadCount is fire-and-forget; no state changes needed
  },
});

// ─── Actions ──────────────────────────────────────────────────────────────────

export const {
  addNotification,
  markAsRead,
  markAllAsRead,
  removeNotification,
} = notificationsSlice.actions;

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Minimal root-shape expected by these selectors. */
interface RootStateSlice {
  notifications: NotificationsState;
}

/** Returns all notifications (newest first). */
export const selectAllNotifications = (state: RootStateSlice): AppNotification[] =>
  state.notifications.notifications;

/** Returns only unread notifications. */
export const selectUnreadNotifications = (state: RootStateSlice): AppNotification[] =>
  state.notifications.notifications.filter((n) => !n.isRead);

/** Returns the current unread count. */
export const selectUnreadCount = (state: RootStateSlice): number =>
  state.notifications.unreadCount;

/** Returns true while the persisted count is being loaded. */
export const selectNotificationsLoading = (state: RootStateSlice): boolean =>
  state.notifications.isLoading;

// ─── Reducer ──────────────────────────────────────────────────────────────────

export default notificationsSlice.reducer;
