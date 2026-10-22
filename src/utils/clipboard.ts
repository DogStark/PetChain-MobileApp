/**
 * Secure clipboard utilities.
 *
 * Copied identifiers (wallet addresses, QR payloads, record references) can
 * linger in the system clipboard indefinitely. These helpers make copy actions
 * explicit and, where the platform supports it, schedule a timeout that clears
 * the clipboard only if it still holds the value we set.
 *
 * Platform limitations:
 * - Web: `navigator.clipboard` requires a secure context and user gesture.
 *   Reading back the clipboard to verify ownership may be blocked by the
 *   browser, so timeout cleanup is best-effort and may be skipped.
 * - iOS/Android (React Native): the clipboard has no native expiry. Cleanup
 *   runs while the app is alive; if the app is backgrounded or killed before
 *   the timeout fires, the value may remain until the OS or user clears it.
 * - Sensitive payloads are never copied silently: callers must pass an explicit
 *   `label` describing exactly what is copied, and sensitive values require
 *   `confirm: true`.
 */

export type ClipboardKind = 'address' | 'qr' | 'record' | 'text';

export interface CopyOptions {
  /** Human-readable description of exactly what is being copied. */
  label: string;
  /** Category of the payload; sensitive kinds require explicit confirmation. */
  kind?: ClipboardKind;
  /** Milliseconds before the clipboard is cleared. 0 disables the timeout. */
  timeoutMs?: number;
  /**
   * Explicit user confirmation. Required for sensitive kinds so that sensitive
   * data is never copied silently.
   */
  confirm?: boolean;
}

const SENSITIVE_KINDS: ReadonlySet<ClipboardKind> = new Set([
  'address',
  'qr',
  'record',
]);

export const DEFAULT_CLIPBOARD_TIMEOUT_MS = 60_000;

interface ClipboardAdapter {
  writeText(value: string): Promise<void>;
  readText(): Promise<string>;
}

function getAdapter(): ClipboardAdapter | null {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && nav.clipboard) {
    return {
      writeText: (value) => nav.clipboard.writeText(value),
      readText: () => nav.clipboard.readText(),
    };
  }
  return null;
}

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearPendingTimer(value: string): void {
  const existing = pendingTimers.get(value);
  if (existing !== undefined) {
    clearTimeout(existing);
    pendingTimers.delete(value);
  }
}

/**
 * Copy `value` to the clipboard with an explicit label and optional timeout.
 *
 * Returns `true` when the value was written. Throws when a sensitive payload is
 * requested without explicit confirmation, or when the clipboard is
 * unavailable.
 */
export async function copyWithTimeout(
  value: string,
  options: CopyOptions,
): Promise<boolean> {
  const { label, kind = 'text', timeoutMs = DEFAULT_CLIPBOARD_TIMEOUT_MS, confirm } = options;

  if (!label || !label.trim()) {
    throw new Error('copyWithTimeout requires a label describing what is copied.');
  }

  if (SENSITIVE_KINDS.has(kind) && confirm !== true) {
    throw new Error(
      `Refusing to copy sensitive ${kind} silently. Pass confirm: true after explicit user action.`,
    );
  }

  const adapter = getAdapter();
  if (!adapter) {
    throw new Error('Clipboard is not available on this platform.');
  }

  await adapter.writeText(value);

  clearPendingTimer(value);

  if (timeoutMs > 0) {
    const timer = setTimeout(() => {
      pendingTimers.delete(value);
      void clearIfUnchanged(adapter, value);
    }, timeoutMs);
    pendingTimers.set(value, timer);
  }

  return true;
}

/**
 * Clear the clipboard only if it still contains `value`. This prevents timeout
 * cleanup from overwriting newer user clipboard content.
 */
export async function clearIfUnchanged(
  adapter: ClipboardAdapter,
  value: string,
): Promise<boolean> {
  try {
    const current = await adapter.readText();
    if (current !== value) {
      return false;
    }
    await adapter.writeText('');
    return true;
  } catch {
    // Reading back may be blocked (e.g. browser permissions); skip cleanup
    // rather than risk clobbering newer content.
    return false;
  }
}

/** Cancel any pending timeout for a previously copied value. */
export function cancelClipboardTimeout(value: string): void {
  clearPendingTimer(value);
}
