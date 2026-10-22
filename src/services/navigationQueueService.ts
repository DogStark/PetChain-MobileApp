/**
 * Navigation Queue Service (#908)
 * Queues deep-link and notification navigation until app-lock verification completes.
 * Prevents sensitive screens from being displayed before device re-authentication.
 */

import { navigationRef } from '../navigation/AppNavigator';

interface QueuedNavigation {
  type: 'deep-link' | 'notification';
  destination: Record<string, unknown>;
  screenName?: string;
}

class NavigationQueueService {
  private queue: QueuedNavigation | null = null;
  private isLockPending = true;

  /**
   * Queue a deep-link navigation until app-lock verification completes.
   * Called from App.tsx on cold-start deep links and notification taps.
   */
  queueDeepLink(destination: Record<string, unknown>, screenName?: string): void {
    this.queue = {
      type: 'deep-link',
      destination,
      screenName,
    };
  }

  /**
   * Queue a notification navigation until app-lock verification completes.
   * Called from AppNavigator when notification tap is received.
   */
  queueNotification(destination: Record<string, unknown>): void {
    // Only keep the most recent notification
    this.queue = {
      type: 'notification',
      destination,
    };
  }

  /**
   * Mark that app-lock verification is pending.
   * Called early in app lifecycle.
   */
  setLockPending(pending: boolean): void {
    this.isLockPending = pending;
  }

  /**
   * Check if navigation should be queued (lock verification still pending).
   */
  isNavigationQueued(): boolean {
    return this.isLockPending && !!this.queue;
  }

  /**
   * Get the queued navigation without clearing it.
   * Used to check if there's a pending navigation.
   */
  peek(): QueuedNavigation | null {
    return this.queue;
  }

  /**
   * Replay queued navigation after successful app-lock verification.
   * Called from App.tsx after LockScreen unlocks.
   */
  replayAndClear(): void {
    if (!this.queue || !navigationRef.current) {
      this.clear();
      return;
    }

    const { destination, screenName } = this.queue;

    try {
      if (screenName) {
        (navigationRef.current as any)?.navigate?.(screenName, destination);
      } else {
        (navigationRef.current as any)?.navigate?.(destination);
      }
    } catch (err) {
      // Navigation failed; still clear queue
    } finally {
      this.clear();
    }
  }

  /**
   * Clear the queued navigation (e.g., on logout or session expiry).
   */
  clear(): void {
    this.queue = null;
  }

  /**
   * Clear queue and mark lock as verified (app-lock check complete).
   */
  clearAndUnlock(): void {
    this.clear();
    this.isLockPending = false;
  }

  /**
   * Reset to initial state (used for testing).
   */
  reset(): void {
    this.queue = null;
    this.isLockPending = true;
  }
}

export default new NavigationQueueService();
