import { useCallback, useEffect, useRef, useState } from 'react';

import { useOptionalToast } from '../context/ToastContext';
import { getAdapter, scheduleSensitiveClear, SENSITIVE_CLEAR_MS } from '../utils/clipboard';

/**
 * Secure clipboard copy button.
 *
 * Security notes / platform limitations:
 * - The user must explicitly trigger the copy; nothing is copied silently.
 * - The button label states exactly what will be copied (the `label` prop).
 * - A configurable timeout clears the clipboard afterwards, but ONLY if the
 *   clipboard still contains the value we set. If the user (or another app)
 *   copied something newer, we leave it untouched.
 * - Clipboard read access is not available on all platforms (notably iOS
 *   Safari and some in-app webviews). Where reading is unsupported we cannot
 *   verify ownership, so we skip the automatic clear rather than risk
 *   overwriting newer content. The timeout is therefore best-effort.
 */

export interface CopyButtonProps {
  /** The exact value that will be placed on the clipboard. */
  value: string;
  /** Human-readable description of what is being copied, shown to the user. */
  label: string;
  /**
   * Milliseconds after which the clipboard is cleared, if it still holds our
   * value. Set to 0 to disable the timeout. Defaults to 30000 (30s).
   */
  timeoutMs?: number;
  /** Optional class name for styling. */
  className?: string;
  /** Called after a successful copy. */
  onCopied?: () => void;
  /**
   * Marks the value as sensitive (wallet address, recovery code, API key).
   * The clipboard is then cleared after 60 seconds with a countdown toast (#1397).
   */
  isSensitive?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function readClipboard(): Promise<string | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      return null;
    }
    return await navigator.clipboard.readText();
  } catch {
    // Read permission denied or unsupported platform.
    return null;
  }
}

export function CopyButton({
  value,
  label,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  className,
  onCopied,
  isSensitive = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSensitiveRef = useRef<(() => void) | null>(null);
  const toast = useOptionalToast();

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    cancelSensitiveRef.current?.();
    cancelSensitiveRef.current = null;
  }, []);

  useEffect(() => clearPendingTimeout, [clearPendingTimeout]);

  const handleCopy = useCallback(async () => {
    setError(null);
    clearPendingTimeout();

    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard is not available on this platform.');
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();

      // Sensitive values are always cleared after 60s, with a countdown toast.
      const adapter = isSensitive ? getAdapter() : null;
      if (adapter) {
        cancelSensitiveRef.current = scheduleSensitiveClear(adapter, value, {
          delayMs: SENSITIVE_CLEAR_MS,
          onTick: (left) => {
            setSecondsLeft(left);
            if (left > 0) {
              toast?.show(`${label} copied. Clipboard will be cleared in ${left}s`, {
                durationMs: 1500,
              });
            }
          },
          onCleared: (cleared) => {
            cancelSensitiveRef.current = null;
            setSecondsLeft(null);
            setCopied(false);
            if (cleared) toast?.show('Clipboard cleared', { variant: 'success' });
          },
        });
      } else if (timeoutMs > 0) {
        timeoutRef.current = setTimeout(async () => {
          timeoutRef.current = null;
          const current = await readClipboard();
          // Only clear when we can confirm the clipboard still holds our value.
          if (current !== null && current === value) {
            try {
              await navigator.clipboard.writeText('');
            } catch {
              // Clearing failed; leave the clipboard as-is.
            }
          }
          setCopied(false);
        }, timeoutMs);
      }
    } catch (err) {
      setCopied(false);
      setError(err instanceof Error ? err.message : 'Copy failed.');
    }
  }, [value, timeoutMs, clearPendingTimeout, onCopied, isSensitive, label, toast]);

  return (
    <span className={className}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        {copied ? 'Copied' : `Copy ${label}`}
      </button>
      {copied && isSensitive && secondsLeft !== null ? (
        <span role="status" aria-live="polite">
          {' '}
          (clipboard clears in {secondsLeft}s)
        </span>
      ) : copied && timeoutMs > 0 ? (
        <span role="status" aria-live="polite">
          {' '}
          (clears in {Math.round(timeoutMs / 1000)}s)
        </span>
      ) : null}
      {error ? (
        <span role="alert"> {error}</span>
      ) : null}
    </span>
  );
}

export default CopyButton;
