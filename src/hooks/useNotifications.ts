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

import { AppState } from 'react-native';

import {
  checkPermissions,
  requestPermissions,
  scheduleFutureNotification,
  cancelScheduledNotification,
  getQuietHoursConfig,
  evaluateQuietHours,
} from '../services/notificationService';
import type { ScheduledNotification, QuietHoursConfig } from '../services/notificationService';

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
  /** Current quiet-hours configuration for the account, or null if not loaded. */
  quietHours: QuietHoursConfig | null;
  /** True while the quiet-hours configuration is being (re)loaded. */
  isLoadingQuietHours: boolean;
  /**
   * Deferral state for the most recently scheduled notification.
   * Null when nothing has been scheduled yet.
   */
  lastDeferral: NotificationDeferral | null;
  /** Force a reload of the quiet-hours config (e.g. after editing settings). */
  refreshQuietHours: () => Promise<void>;
}

/** Describes how a notification was deferred due to quiet hours. */
export interface NotificationDeferral {
  /** True when the notification was moved out of quiet hours. */
  deferred: boolean;
  /** The originally requested delivery time (ISO string). */
  originalTime: string;
  /** The actual delivery time used (ISO string). */
  scheduledTime: string;
  /** The quiet-hours config that caused the deferral, if any. */
  quietHours: QuietHoursConfig | null;
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
  const [quietHours, setQuietHours] = useState<QuietHoursConfig | null>(null);
  const [isLoadingQuietHours, setIsLoadingQuietHours] = useState(false);
  const [lastDeferral, setLastDeferral] = useState<NotificationDeferral | null>(null);

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

  // ── Quiet hours: load + recompute on timezone change ───────────────────────

  const loadQuietHours = useCallback(async (): Promise<void> => {
    setIsLoadingQuietHours(true);
    try {
      const config = await getQuietHoursConfig();
      if (isMounted.current) {
        setQuietHours(config);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err : new Error('Failed to load quiet hours'));
      }
    } finally {
      if (isMounted.current) {
        setIsLoadingQuietHours(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadQuietHours();
  }, [loadQuietHours]);

  // Recompute deferral state when the app returns to the foreground or the
  // device timezone offset changes (e.g. travel, DST transitions).
  const timezoneOffsetRef = useRef<number>(new Date().getTimezoneOffset());

  useEffect(() => {
    const handleAppStateChange = (nextState: string): void => {
      if (nextState !== 'active') {
        return;
      }
      const currentOffset = new Date().getTimezoneOffset();
      if (currentOffset !== timezoneOffsetRef.current) {
        timezoneOffsetRef.current = currentOffset;
        // Timezone changed: reload config and re-evaluate last deferral.
        void loadQuietHours();
        setLastDeferral((prev) => {
          if (!prev || !prev.deferred) {
            return prev;
          }
          const original = new Date(prev.originalTime);
          const evaluation = evaluateQuietHours(original, quietHours);
          return {
            deferred: evaluation.deferred,
            originalTime: prev.originalTime,
            scheduledTime: evaluation.scheduledTime.toISOString(),
            quietHours,
          };
        });
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [loadQuietHours, quietHours]);

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
        const originalTime = new Date(notification.triggerDate);
        const evaluation = evaluateQuietHours(originalTime, quietHours);

        const effectiveNotification: ScheduledNotification = evaluation.deferred
          ? {
              ...notification,
              triggerDate: evaluation.scheduledTime,
              deferred: true,
              originalTime: originalTime.toISOString(),
            }
          : notification;

        const id = await scheduleFutureNotification(effectiveNotification);

        if (isMounted.current) {
          setLastDeferral({
            deferred: evaluation.deferred,
            originalTime: originalTime.toISOString(),
            scheduledTime: evaluation.scheduledTime.toISOString(),
            quietHours,
          });
        }

        return id;
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error('Failed to schedule notification');
        if (isMounted.current) {
          setError(wrapped);
        }
        throw wrapped;
      }
    },
    [quietHours],
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
    quietHours,
    isLoadingQuietHours,
    lastDeferral,
    refreshQuietHours: loadQuietHours,
  };
}

export default useNotifications;
