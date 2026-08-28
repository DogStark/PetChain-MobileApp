/**
 * NotificationItem — reusable row for the notification center.
 *
 * Renders read/unread distinction, category icon, timestamp, and handles
 * deep-link navigation via validated navPayload.
 */
import React, { memo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { AppNotification, NotificationCategory } from '../services/notificationStore';

// Re-export so existing imports from this file continue to work.
export { resolveNavPayload } from '../utils/notificationNavigation';

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<NotificationCategory, { icon: string; label: string }> = {
  medication: { icon: '💊', label: 'Medication' },
  appointment: { icon: '📅', label: 'Appointment' },
  sos: { icon: '🆘', label: 'Emergency' },
  system: { icon: '🔔', label: 'System' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NotificationItemProps {
  notification: AppNotification;
  onPress: (notification: AppNotification) => void;
  onLongPress?: (notification: AppNotification) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

function NotificationItem({
  notification,
  onPress,
  onLongPress,
  style,
  testID,
}: NotificationItemProps) {
  const meta = CATEGORY_META[notification.category] ?? CATEGORY_META.system;

  const handlePress = useCallback(() => onPress(notification), [onPress, notification]);
  const handleLongPress = useCallback(
    () => onLongPress?.(notification),
    [onLongPress, notification],
  );

  return (
    <TouchableOpacity
      testID={testID ?? `notification-item-${notification.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}: ${notification.title}. ${notification.isRead ? 'Read' : 'Unread'}`}
      accessibilityHint="Tap to open, long press for options"
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      style={[styles.container, !notification.isRead && styles.unread, style]}
      activeOpacity={0.7}
    >
      {/* Unread indicator */}
      {!notification.isRead && <View style={styles.unreadDot} accessibilityElementsHidden />}

      {/* Icon */}
      <Text style={styles.icon} accessibilityElementsHidden>
        {meta.icon}
      </Text>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text
            style={[styles.title, !notification.isRead && styles.titleUnread]}
            numberOfLines={1}
          >
            {notification.title}
          </Text>
          <Text style={styles.time}>{formatRelativeTime(notification.createdAt)}</Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>
          {notification.body}
        </Text>
        <Text style={styles.category}>{meta.label}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default memo(NotificationItem);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D5DB',
  },
  unread: {
    backgroundColor: '#F0FDF4',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
    marginTop: 6,
    marginEnd: 4,
    flexShrink: 0,
  },
  icon: {
    fontSize: 24,
    marginEnd: 12,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  title: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    marginEnd: 8,
  },
  titleUnread: {
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
    color: '#6B7280',
    flexShrink: 0,
  },
  body: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
    marginBottom: 4,
  },
  category: {
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
