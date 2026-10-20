/**
 * focusRecovery.ts
 *
 * Cross-platform focus recovery manager for dialogs, pickers, and permission
 * prompts (issue #1198).
 *
 * Responsibilities:
 *  - Track initiating controls across nested dialogs, native pickers, and
 *    permission prompts so focus returns deterministically on dismissal.
 *  - Support iOS/Android screen-reader focus (`AccessibilityInfo.setAccessibilityFocus`
 *    via `findNodeHandle`) as well as imperative `.focus()` for keyboard/web targets.
 *  - Retry focus restoration when a control's native node handle is not yet
 *    available on the first frame after dismissal, and fall back to a secondary
 *    ref when the primary initiating control was unmounted or disabled.
 *  - Validate server-confirmed permission state while preserving offline cached
 *    behavior, and surface accessible recovery announcements on permission denial
 *    or stale-data dismissal.
 *  - Keep sensitive pet data (microchip IDs, wallet addresses, emails, phone
 *    numbers, and raw medical tokens) private by default in spoken announcements.
 */

import type React from 'react';
import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native';

export type FocusSurfaceType = 'dialog' | 'picker' | 'permission_prompt';

export type FocusDismissalReason =
  | 'confirm'
  | 'cancel'
  | 'backdrop'
  | 'hardware_back'
  | 'permission_granted'
  | 'permission_denied'
  | 'stale_data'
  | 'error';

export interface FocusTargetLike {
  focus?: () => void;
  isDisabled?: boolean;
  disabled?: boolean;
}

export type FocusTargetRef = React.RefObject<FocusTargetLike | unknown | null>;

export interface FocusRecoveryEntry {
  id: string;
  surfaceType: FocusSurfaceType;
  triggerRef?: FocusTargetRef;
  fallbackRef?: FocusTargetRef;
  openedAt: number;
  label?: string;
}

export interface ServerPermissionState {
  permission: string;
  serverConfirmed: boolean;
  granted: boolean;
  confirmedAt: number | null;
  staleAfterMs?: number;
  isOffline?: boolean;
  offlineCachedGrant?: boolean;
}

export interface PermissionEvaluationResult {
  allowed: boolean;
  status: 'confirmed_grant' | 'offline_cached_grant' | 'denied' | 'stale';
  reasonMessage: string;
}

export interface RestoreFocusOptions {
  surfaceType?: FocusSurfaceType;
  reason?: FocusDismissalReason;
  announcement?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  now?: number;
  permissionState?: ServerPermissionState;
  onRecovered?: (outcome: FocusRecoveryOutcome) => void;
}

export interface FocusRecoveryOutcome {
  restored: boolean;
  usedFallback: boolean;
  nodeHandle: number | null;
  usedImperativeFocus: boolean;
  attempts: number;
  reason: FocusDismissalReason;
  surfaceType: FocusSurfaceType;
  announcedText: string | null;
  permissionStatus?: PermissionEvaluationResult['status'];
}

const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Patterns that must never be spoken aloud during focus recovery announcements.
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Stellar public keys / account addresses (G... 56 chars)
  { pattern: /\bG[A-Z2-7]{55}\b/g, replacement: '[redacted-address]' },
  // 15-digit ISO pet microchip numbers
  { pattern: /\b\d{15}\b/g, replacement: '[redacted-microchip]' },
  // Email addresses
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[redacted-email]',
  },
  // Phone numbers (international / US formats)
  {
    pattern: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
    replacement: '[redacted-phone]',
  },
  // Explicit secret / token key-value fragments
  {
    pattern: /\b(?:token|secret|apiKey|medicalRecordId|petSecret)=[^\s,;]+/gi,
    replacement: '[redacted]',
  },
];

/**
 * Redacts sensitive pet/owner identifiers from spoken accessibility announcements
 * so focus recovery never leaks private data to screen readers or logs.
 */
export function sanitizeFocusAnnouncement(rawText?: string | null): string {
  if (!rawText) return '';
  let sanitized = rawText.trim();
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * Evaluates server-confirmed permission state while preserving existing offline
 * behavior when the device is offline and holds a previously cached grant.
 */
export function evaluateServerPermissionForFocus(
  state: ServerPermissionState,
  now: number = Date.now(),
): PermissionEvaluationResult {
  const staleWindow = state.staleAfterMs ?? DEFAULT_STALE_THRESHOLD_MS;

  if (state.isOffline) {
    if (state.offlineCachedGrant || (state.granted && state.serverConfirmed)) {
      return {
        allowed: true,
        status: 'offline_cached_grant',
        reasonMessage: 'Offline mode active. Using saved permission settings.',
      };
    }
    return {
      allowed: false,
      status: 'denied',
      reasonMessage: 'Permission is not granted while offline. Review permission settings.',
    };
  }

  if (!state.serverConfirmed || !state.granted) {
    return {
      allowed: false,
      status: 'denied',
      reasonMessage: 'Permission was denied. Focus returned to the initiating control.',
    };
  }

  if (state.confirmedAt === null || now - state.confirmedAt > staleWindow) {
    return {
      allowed: false,
      status: 'stale',
      reasonMessage:
        'Permission confirmation is stale. Refresh or retry from the initiating control.',
    };
  }

  return {
    allowed: true,
    status: 'confirmed_grant',
    reasonMessage: 'Permission confirmed.',
  };
}

/**
 * Builds a concise, privacy-safe announcement when a surface closes due to
 * denial, stale data, or error, or when an explicit announcement is supplied.
 */
export function buildDismissalAnnouncement(options: {
  surfaceType?: FocusSurfaceType;
  reason?: FocusDismissalReason;
  announcement?: string;
  permissionEvaluation?: PermissionEvaluationResult;
}): string | null {
  const { surfaceType = 'dialog', reason = 'cancel', announcement, permissionEvaluation } = options;

  if (announcement && announcement.trim().length > 0) {
    return sanitizeFocusAnnouncement(announcement);
  }

  if (permissionEvaluation && !permissionEvaluation.allowed) {
    return sanitizeFocusAnnouncement(permissionEvaluation.reasonMessage);
  }

  switch (reason) {
    case 'permission_denied':
      return 'Permission denied. Focus returned to the initiating control.';
    case 'stale_data':
      return 'Data is out of date. Focus returned to the retry control.';
    case 'error':
      return `${
        surfaceType === 'picker'
          ? 'Picker'
          : surfaceType === 'permission_prompt'
            ? 'Permission prompt'
            : 'Dialog'
      } closed due to an error. Focus restored.`;
    default:
      return null;
  }
}

function isTargetUsable(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as FocusTargetLike;
  if (candidate.disabled === true || candidate.isDisabled === true) {
    return false;
  }
  return true;
}

function tryFocusSingleTarget(ref?: FocusTargetRef): {
  focused: boolean;
  nodeHandle: number | null;
  usedImperativeFocus: boolean;
} {
  const current = ref?.current;
  if (!isTargetUsable(current)) {
    return { focused: false, nodeHandle: null, usedImperativeFocus: false };
  }

  let nodeHandle: number | null = null;
  try {
    nodeHandle = findNodeHandle(current as never);
  } catch {
    nodeHandle = null;
  }

  if (nodeHandle !== null && nodeHandle !== undefined) {
    AccessibilityInfo.setAccessibilityFocus(nodeHandle);
  }

  let usedImperativeFocus = false;
  const candidate = current as FocusTargetLike;
  if (
    typeof candidate.focus === 'function' &&
    (Platform.OS === 'web' || nodeHandle === null || nodeHandle === undefined)
  ) {
    try {
      candidate.focus();
      usedImperativeFocus = true;
    } catch {
      usedImperativeFocus = false;
    }
  }

  const focused =
    (nodeHandle !== null && nodeHandle !== undefined) || usedImperativeFocus;

  return { focused, nodeHandle: nodeHandle ?? null, usedImperativeFocus };
}

/**
 * Restores focus to `triggerRef` (or `fallbackRef` if `triggerRef` is unavailable
 * or disabled) with bounded retry support across platforms.
 */
export function restoreFocusToInitiator(
  triggerRef?: FocusTargetRef,
  fallbackRef?: FocusTargetRef,
  options: RestoreFocusOptions = {},
): () => void {
  const {
    surfaceType = 'dialog',
    reason = 'cancel',
    announcement,
    maxRetries = 2,
    retryDelayMs = 50,
    now = Date.now(),
    permissionState,
    onRecovered,
  } = options;

  const permissionEvaluation = permissionState
    ? evaluateServerPermissionForFocus(permissionState, now)
    : undefined;

  const effectiveReason: FocusDismissalReason =
    permissionEvaluation && !permissionEvaluation.allowed
      ? permissionEvaluation.status === 'stale'
        ? 'stale_data'
        : 'permission_denied'
      : reason;

  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const finish = (
    restored: boolean,
    usedFallback: boolean,
    nodeHandle: number | null,
    usedImperativeFocus: boolean,
  ) => {
    if (cancelled) return;
    const spoken = buildDismissalAnnouncement({
      surfaceType,
      reason: effectiveReason,
      announcement,
      permissionEvaluation,
    });
    if (spoken) {
      AccessibilityInfo.announceForAccessibility(spoken);
    }
    onRecovered?.({
      restored,
      usedFallback,
      nodeHandle,
      usedImperativeFocus,
      attempts,
      reason: effectiveReason,
      surfaceType,
      announcedText: spoken,
      permissionStatus: permissionEvaluation?.status,
    });
  };

  const attemptFocus = () => {
    if (cancelled) return;
    attempts += 1;

    const primary = tryFocusSingleTarget(triggerRef);
    if (primary.focused) {
      finish(true, false, primary.nodeHandle, primary.usedImperativeFocus);
      return;
    }

    if (attempts <= maxRetries && isTargetUsable(triggerRef?.current)) {
      timer = setTimeout(attemptFocus, retryDelayMs);
      return;
    }

    const fallback = tryFocusSingleTarget(fallbackRef);
    if (fallback.focused) {
      finish(true, true, fallback.nodeHandle, fallback.usedImperativeFocus);
      return;
    }

    if (attempts <= maxRetries && (triggerRef || fallbackRef)) {
      timer = setTimeout(attemptFocus, retryDelayMs);
      return;
    }

    finish(false, Boolean(fallbackRef), null, false);
  };

  timer = setTimeout(attemptFocus, retryDelayMs);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Stack-aware registry for active dialogs, pickers, and permission prompts.
 * Ensures nested overlays restore focus to the immediate initiator when closed.
 */
export class FocusRecoveryRegistry {
  private readonly entries: FocusRecoveryEntry[] = [];

  register(entry: Omit<FocusRecoveryEntry, 'openedAt'> & { openedAt?: number }): void {
    const existingIdx = this.entries.findIndex((e) => e.id === entry.id);
    const normalized: FocusRecoveryEntry = {
      ...entry,
      label: entry.label ? sanitizeFocusAnnouncement(entry.label) : undefined,
      openedAt: entry.openedAt ?? Date.now(),
    };
    if (existingIdx !== -1) {
      this.entries[existingIdx] = normalized;
    } else {
      this.entries.push(normalized);
    }
  }

  /**
   * Pops or removes the entry by `id` and returns it along with the new top entry
   * (if a parent modal remains open underneath).
   */
  dismiss(id: string): {
    dismissed?: FocusRecoveryEntry;
    remainingTop?: FocusRecoveryEntry;
  } {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) {
      return {
        dismissed: undefined,
        remainingTop: this.top(),
      };
    }
    const [dismissed] = this.entries.splice(idx, 1);
    return {
      dismissed,
      remainingTop: this.top(),
    };
  }

  top(): FocusRecoveryEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  isTop(id: string): boolean {
    return this.entries.length > 0 && this.entries[this.entries.length - 1].id === id;
  }

  depth(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export const focusRecoveryRegistry = new FocusRecoveryRegistry();
