import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Privacy-safe diagnostic state for network / certificate-pinning failures.
 *
 * SECURITY: this state intentionally carries NO certificate private material
 * (no public key hashes, no PEM/DER bytes, no pins) and NO record data
 * (no payloads, tokens, or user content). Only coarse, non-identifying
 * metadata is retained so support can triage an outage.
 */
export type NetworkDiagnosticKind =
  | 'pinning_mismatch'
  | 'offline'
  | 'timeout'
  | 'generic';

export interface NetworkDiagnosticState {
  kind: NetworkDiagnosticKind;
  /** Stable, non-identifying support code derived from the failure kind. */
  supportCode: string;
  /** Coarse host label only (no path, query, or credentials). */
  host?: string;
  /** ISO timestamp of the failure, for correlation with server logs. */
  occurredAt: string;
}

const SUPPORT_CODE_PREFIX = 'NET';

/**
 * Map a raw error into a dedicated, privacy-safe diagnostic state.
 * Certificate-pinning failures are surfaced as their own kind instead of a
 * generic network error so triage is unambiguous.
 */
export function classifyNetworkError(error: unknown, host?: string): NetworkDiagnosticState {
  const message = extractMessage(error).toLowerCase();
  const kind = detectKind(message);
  return {
    kind,
    supportCode: buildSupportCode(kind),
    host: sanitizeHost(host),
    occurredAt: new Date().toISOString(),
  };
}

function extractMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    return typeof msg === 'string' ? msg : '';
  }
  return '';
}

function detectKind(message: string): NetworkDiagnosticKind {
  if (
    message.includes('pinning') ||
    message.includes('certificate') ||
    message.includes('ssl') ||
    message.includes('trust') ||
    message.includes('cert')
  ) {
    return 'pinning_mismatch';
  }
  if (message.includes('offline') || message.includes('no internet') || message.includes('network request failed')) {
    return 'offline';
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }
  return 'generic';
}

function buildSupportCode(kind: NetworkDiagnosticKind): string {
  const suffix = kind.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return `${SUPPORT_CODE_PREFIX}-${suffix}`;
}

/** Strip any path/query/credentials so only a coarse host label remains. */
function sanitizeHost(host?: string): string | undefined {
  if (!host) return undefined;
  const withoutScheme = host.replace(/^[a-z]+:\/\//i, '');
  const hostOnly = withoutScheme.split(/[/?#]/)[0];
  const withoutCreds = hostOnly.includes('@') ? hostOnly.split('@').pop() ?? '' : hostOnly;
  return withoutCreds || undefined;
}

/**
 * Build the exportable support payload. Contains ONLY the privacy-safe
 * diagnostic fields — never certificate material or record data.
 */
export function buildSupportExport(state: NetworkDiagnosticState): string {
  return JSON.stringify(
    {
      supportCode: state.supportCode,
      kind: state.kind,
      host: state.host ?? null,
      occurredAt: state.occurredAt,
    },
    null,
    2,
  );
}

interface NetworkErrorScreenProps {
  error?: unknown;
  host?: string;
  onRetry?: () => void;
  /** Optional override for tests / callers that already classified the error. */
  diagnostic?: NetworkDiagnosticState;
}

const COPY: Record<NetworkDiagnosticKind, { title: string; body: string }> = {
  pinning_mismatch: {
    title: 'Secure connection could not be verified',
    body:
      'We blocked this connection because the server certificate did not match the expected pin. ' +
      'For your safety we never fall back to an insecure connection. Please retry, and if this ' +
      'continues, contact support with the code below.',
  },
  offline: {
    title: 'You appear to be offline',
    body: 'Check your connection and try again. Your data is safe and will sync once you are back online.',
  },
  timeout: {
    title: 'The request timed out',
    body: 'The server took too long to respond. Please retry in a moment.',
  },
  generic: {
    title: 'Something went wrong',
    body: 'We could not complete your request. Please retry, and contact support if the problem persists.',
  },
};

export default function NetworkErrorScreen({
  error,
  host,
  onRetry,
  diagnostic,
}: NetworkErrorScreenProps) {
  const state = useMemo(
    () => diagnostic ?? classifyNetworkError(error, host),
    [diagnostic, error, host],
  );
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = COPY[state.kind];
  const isPinning = state.kind === 'pinning_mismatch';

  const handleRetry = useCallback(() => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      onRetry();
    } finally {
      setRetrying(false);
    }
  }, [onRetry]);

  const handleExport = useCallback(async () => {
    await Clipboard.setStringAsync(buildSupportExport(state));
    setCopied(true);
  }, [state]);

  return (
    <ScrollView contentContainerStyle={styles.container} testID="network-error-screen">
      <Text style={styles.title} testID="network-error-title">
        {copy.title}
      </Text>
      <Text style={styles.body} testID="network-error-body">
        {copy.body}
      </Text>

      {isPinning ? (
        <View style={styles.notice} testID="pinning-notice">
          <Text style={styles.noticeText}>
            Insecure fallback is disabled. We will not bypass certificate pinning.
          </Text>
        </View>
      ) : null}

      <View style={styles.diagnostics} testID="network-diagnostics">
        <Text style={styles.diagLabel}>Support code</Text>
        <Text style={styles.diagValue} testID="support-code">
          {state.supportCode}
        </Text>
        {state.host ? (
          <>
            <Text style={styles.diagLabel}>Host</Text>
            <Text style={styles.diagValue}>{state.host}</Text>
          </>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.button, styles.primaryButton]}
        onPress={handleRetry}
        disabled={retrying || !onRetry}
        testID="retry-button"
      >
        {retrying ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Retry</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.secondaryButton]}
        onPress={handleExport}
        testID="export-support-code-button"
      >
        <Text style={styles.secondaryButtonText}>
          {copied ? 'Support code copied' : 'Copy support code'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    textAlign: 'center',
    color: '#444',
    marginBottom: 20,
  },
  notice: {
    backgroundColor: '#FFF4E5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  noticeText: {
    fontSize: 13,
    color: '#8A5A00',
    textAlign: 'center',
  },
  diagnostics: {
    alignSelf: 'stretch',
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
  },
  diagLabel: {
    fontSize: 12,
    color: '#777',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  diagValue: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  button: {
    alignSelf: 'stretch',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#1E6FD9',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1E6FD9',
  },
  secondaryButtonText: {
    color: '#1E6FD9',
    fontSize: 16,
    fontWeight: '600',
  },
});
