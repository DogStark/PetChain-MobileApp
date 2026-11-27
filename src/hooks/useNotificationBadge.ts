/**
 * Notification badge and offline draft queue count hooks.
 *
 * useNotificationBadge returns the current unread notification count and a
 * refresh function, subscribing to notificationStore changes so the badge
 * updates immediately whenever notifications are added, read, or deleted.
 *
 * useDraftQueueCount returns the number of offline drafts still waiting to
 * sync (issue #1362) and subscribes to draftQueueStatusService changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getUnreadCount, subscribeToNotificationChanges } from '../services/notificationStore';
import {
  getPendingDraftCount,
  subscribeToDraftQueueChanges,
} from '../services/draftQueueStatusService';

/**
 * useDraftQueueCount
 *
 * Returns the number of offline drafts still waiting to sync and a refresh
 * function. Subscribes to draftQueueStatusService changes so the header
 * indicator updates as soon as drafts are queued, retried or completed.
 */
export function useDraftQueueCount(): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    getPendingDraftCount()
      .then((n) => {
        if (isMounted.current) setCount(n);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    return subscribeToDraftQueueChanges(refresh);
  }, [refresh]);

  return { count, refresh };
}

/**
 * useNotificationBadge
 *
 * Returns the current unread notification count and a refresh function.
 * Subscribes to notificationStore changes so the badge updates immediately
 * whenever notifications are added, read, or deleted — including while
 * NotificationCenterScreen is open.
 */
export function useNotificationBadge(): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    getUnreadCount()
      .then((n) => {
        if (isMounted.current) setCount(n);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // Re-run whenever any write operation fires in the store
    return subscribeToNotificationChanges(refresh);
  }, [refresh]);

  return { count, refresh };
}
