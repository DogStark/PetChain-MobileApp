/**
 * Certificate pinning service.
 *
 * Provides a privacy-safe diagnostic state for certificate-pinning failures so
 * that outages can be triaged without leaking certificate private material or
 * record data. Pinning failures are mapped to a dedicated state (never a
 * generic network error) and no HTTP fallback is ever permitted to bypass
 * pinning.
 */

export type PinningFailureReason =
  | 'pin_mismatch'
  | 'certificate_expired'
  | 'certificate_untrusted'
  | 'pinning_unavailable';

export type PinningDiagnosticState =
  | { status: 'ok' }
  | {
      status: 'pinning_failure';
      reason: PinningFailureReason;
      /** Stable, non-sensitive support code for triage. */
      supportCode: string;
      /** Actionable, user-facing guidance. */
      guidance: string;
      /** Whether a retry is safe to attempt. */
      retryable: boolean;
    };

/**
 * A pinning failure is never retried over plain HTTP. There is no fallback
 * path that bypasses pinning; callers must surface the diagnostic instead.
 */
export const HTTP_FALLBACK_ALLOWED = false;

const SUPPORT_CODE_PREFIX = 'PIN';

const REASON_CODES: Record<PinningFailureReason, string> = {
  pin_mismatch: '01',
  certificate_expired: '02',
  certificate_untrusted: '03',
  pinning_unavailable: '04',
};

const REASON_GUIDANCE: Record<PinningFailureReason, string> = {
  pin_mismatch:
    'We could not verify the secure connection to our servers. This can happen on untrusted networks. Reconnect to a trusted network and retry.',
  certificate_expired:
    'The secure connection could not be verified because the server certificate is out of date. Please retry in a few minutes.',
  certificate_untrusted:
    'The secure connection could not be trusted. Avoid public or unknown Wi-Fi, then retry.',
  pinning_unavailable:
    'Secure connection verification is unavailable on this device. Update the app and retry.',
};

/**
 * Build a stable support code from a failure reason. The code contains only a
 * reason identifier and a coarse timestamp bucket — no certificate material,
 * hostnames, or record data.
 */
export function buildSupportCode(
  reason: PinningFailureReason,
  now: number = Date.now(),
): string {
  const bucket = Math.floor(now / (60 * 60 * 1000));
  return `${SUPPORT_CODE_PREFIX}-${REASON_CODES[reason]}-${bucket.toString(36).toUpperCase()}`;
}

/**
 * Map a raw pinning error to a privacy-safe diagnostic state. Any error that
 * is not a recognized pinning failure is treated as a pinning failure rather
 * than a generic network error, so pinning is never silently bypassed.
 */
export function mapPinningFailure(
  error: unknown,
  now: number = Date.now(),
): PinningDiagnosticState {
  const reason = classifyPinningFailure(error);
  return {
    status: 'pinning_failure',
    reason,
    supportCode: buildSupportCode(reason, now),
    guidance: REASON_GUIDANCE[reason],
    retryable: reason !== 'pinning_unavailable',
  };
}

function classifyPinningFailure(error: unknown): PinningFailureReason {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  const normalized = message.toLowerCase();

  if (normalized.includes('expired')) {
    return 'certificate_expired';
  }
  if (normalized.includes('untrusted') || normalized.includes('self-signed')) {
    return 'certificate_untrusted';
  }
  if (normalized.includes('unavailable') || normalized.includes('not supported')) {
    return 'pinning_unavailable';
  }
  return 'pin_mismatch';
}

/**
 * Export a support payload for triage. Deliberately excludes certificate
 * private material and record data — only the diagnostic state is included.
 */
export function exportSupportDiagnostics(
  state: PinningDiagnosticState,
): string {
  if (state.status === 'ok') {
    return JSON.stringify({ status: 'ok' });
  }
  return JSON.stringify({
    status: state.status,
    reason: state.reason,
    supportCode: state.supportCode,
    retryable: state.retryable,
  });
}
