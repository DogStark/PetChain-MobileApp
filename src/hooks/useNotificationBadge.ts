/**
 * useNotificationBadge
 *
 * Returns the current unread notification count and a refresh function.
 * Subscribes to notificationStore changes so the badge updates immediately
 * whenever notifications are added, read, or deleted — including while
 * NotificationCenterScreen is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getUnreadCount, subscribeToNotificationChanges } from '../services/notificationStore';

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
