/**
 * useNotifications
 *
 * Custom React hook for managing Expo notification permissions,
 * scheduling local notifications, and cancelling them.
 *
 * Returns:
 *   hasPermission      - whether push-notification permission is currently granted
 *   requestPermission  - async function that prompts the user for permission
 *   schedule           - async function to schedule a local notification
 *   cancel             - async function to cancel a scheduled notification by id
 *
 * Usage:
 *   const { hasPermission, requestPermission, schedule, cancel } = useNotifications();
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  checkPermissions,
  requestPermissions,
  scheduleFutureNotification,
  cancelScheduledNotification,
} from '../services/notificationService';
import type { ScheduledNotification } from '../services/notificationService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseNotificationsReturn {
  /** True when the user has granted notification permission. */
  hasPermission: boolean;
  /** True while a permission check or request is in progress. */
  isCheckingPermission: boolean;
  /**
   * Request notification permission from the OS.
   * @returns true if permission was granted, false otherwise.
   */
  requestPermission: () => Promise<boolean>;
  /**
   * Schedule a future local notification.
   * @param notification - The notification payload to schedule.
   * @returns The notification identifier assigned by Expo.
   */
  schedule: (notification: ScheduledNotification) => Promise<string>;
  /**
   * Cancel a previously scheduled notification by its identifier.
   * @param notificationId - The identifier returned by `schedule`.
   */
  cancel: (notificationId: string) => Promise<void>;
  /** Last error encountered during any operation, or null. */
  error: Error | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages Expo notification permissions, scheduling, and cancellation.
 * Permission status is checked automatically on mount.
 */
export function useNotifications(): UseNotificationsReturn {
  const [hasPermission, setHasPermission] = useState(false);
  const [isCheckingPermission, setIsCheckingPermission] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Guard against state updates after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // ── Check permission on mount ──────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function checkOnMount(): Promise<void> {
      setIsCheckingPermission(true);
      try {
        const granted = await checkPermissions();
        if (!cancelled && isMounted.current) {
          setHasPermission(granted);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && isMounted.current) {
          setError(err instanceof Error ? err : new Error('Failed to check permissions'));
        }
      } finally {
        if (!cancelled && isMounted.current) {
          setIsCheckingPermission(false);
        }
      }
    }

    void checkOnMount();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── requestPermission ──────────────────────────────────────────────────────

  const requestPermission = useCallback(async (): Promise<boolean> => {
    setIsCheckingPermission(true);
    setError(null);
    try {
      const granted = await requestPermissions();
      if (isMounted.current) {
        setHasPermission(granted);
      }
      return granted;
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Failed to request permissions');
      if (isMounted.current) {
        setError(wrapped);
      }
      return false;
    } finally {
      if (isMounted.current) {
        setIsCheckingPermission(false);
      }
    }
  }, []);

  // ── schedule ───────────────────────────────────────────────────────────────

  const schedule = useCallback(
    async (notification: ScheduledNotification): Promise<string> => {
      setError(null);
      try {
        const id = await scheduleFutureNotification(notification);
        return id;
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error('Failed to schedule notification');
        if (isMounted.current) {
          setError(wrapped);
        }
        throw wrapped;
      }
    },
    [],
  );

  // ── cancel ─────────────────────────────────────────────────────────────────

  const cancel = useCallback(async (notificationId: string): Promise<void> => {
    setError(null);
    try {
      await cancelScheduledNotification(notificationId);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Failed to cancel notification');
      if (isMounted.current) {
        setError(wrapped);
      }
      throw wrapped;
    }
  }, []);

  return {
    hasPermission,
    isCheckingPermission,
    requestPermission,
    schedule,
    cancel,
    error,
  };
}

export default useNotifications;
