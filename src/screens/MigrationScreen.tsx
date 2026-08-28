import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// ---------------------------------------------------------------------------
// Types (mirrors backend MigrationProgress / MigrationRunResult)
// ---------------------------------------------------------------------------

interface MigrationProgress {
  runId: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  estimatedSecondsRemaining: number | null;
  startedAt: string;
}

interface MigrationRunResult {
  runId: string;
  total: number;
  migrated: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

type ScreenState = 'idle' | 'running' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MigrationScreen() {
  const [state, setState] = useState<ScreenState>('idle');
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationRunResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isRetrying, setIsRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef<string | null>(null);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollProgress = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/migration/progress/${encodeURIComponent(runId)}`);
      if (!res.ok) return;
      const data: MigrationProgress = await res.json();
      setProgress(data);

      // Announce progress to screen readers
      if (data.total > 0) {
        const msg = `Migration ${pct(data.completed, data.total)}% complete. ${data.completed} of ${data.total} records migrated.`;
        AccessibilityInfo.announceForAccessibility(msg);
      }
    } catch {
      // Non-fatal: keep polling
    }
  }, []);

  const startMigration = useCallback(async () => {
    if (state === 'running') return; // Prevent duplicate requests

    setState('running');
    setProgress(null);
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/migration/start', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Server error ${res.status}`);
      }
      const data: { runId: string } = await res.json();
      runIdRef.current = data.runId;

      // Poll progress every 3 seconds
      pollRef.current = setInterval(() => pollProgress(data.runId), 3000);

      // Wait for completion
      const resultRes = await fetch(`/api/migration/await/${encodeURIComponent(data.runId)}`);
      stopPolling();

      if (!resultRes.ok) {
        const body = await resultRes.json().catch(() => ({}));
        throw new Error(body.message ?? `Migration failed with status ${resultRes.status}`);
      }

      const runResult: MigrationRunResult = await resultRes.json();
      setResult(runResult);
      setState('done');
      AccessibilityInfo.announceForAccessibility(
        `Migration complete. ${runResult.migrated} records migrated, ${runResult.failed} failed.`,
      );
    } catch (err) {
      stopPolling();
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMsg(msg);
      setState('error');
    }
  }, [state, pollProgress, stopPolling]);

  const retryFailed = useCallback(async () => {
    if (!runIdRef.current || isRetrying) return;
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/migration/retry/${encodeURIComponent(runIdRef.current)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Retry request failed');
      // Re-run migration (will resume from failed checkpoints)
      await startMigration();
    } catch (err) {
      Alert.alert('Retry failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRetrying(false);
    }
  }, [runIdRef, isRetrying, startMigration]);

  const reset = useCallback(() => {
    stopPolling();
    setState('idle');
    setProgress(null);
    setResult(null);
    setErrorMsg('');
    runIdRef.current = null;
  }, [stopPolling]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const completedPct = progress ? pct(progress.completed, progress.total) : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Stellar Migration Screen"
    >
      <Text style={styles.title} accessibilityRole="header">
        Testnet → Mainnet Migration
      </Text>
      <Text style={styles.subtitle}>
        Securely re-anchors your medical records from Stellar testnet to mainnet.
      </Text>

      {/* ---- IDLE ---- */}
      {state === 'idle' && (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={startMigration}
          accessibilityRole="button"
          accessibilityLabel="Start migration"
          accessibilityHint="Begins migrating your medical records from Stellar testnet to mainnet"
        >
          <Text style={styles.primaryButtonText}>Start Migration</Text>
        </TouchableOpacity>
      )}

      {/* ---- RUNNING ---- */}
      {state === 'running' && (
        <View accessibilityLiveRegion="polite">
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.spinner}
            accessibilityLabel="Migration in progress"
          />

          {progress ? (
            <View style={styles.progressCard}>
              {/* Progress bar */}
              <View
                style={styles.progressBarTrack}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: completedPct }}
              >
                <View style={[styles.progressBarFill, { width: `${completedPct}%` }]} />
              </View>
              <Text style={styles.progressPct}>{completedPct}%</Text>

              <View style={styles.statsRow}>
                <Stat label="Total" value={progress.total} />
                <Stat label="Migrated" value={progress.completed} color={colors.success} />
                <Stat label="Failed" value={progress.failed} color={colors.error} />
                <Stat label="Skipped" value={progress.skipped} color={colors.warning} />
              </View>

              <Text style={styles.eta}>ETA: {formatEta(progress.estimatedSecondsRemaining)}</Text>
            </View>
          ) : (
            <Text style={styles.hint}>Preparing migration…</Text>
          )}
        </View>
      )}

      {/* ---- DONE ---- */}
      {state === 'done' && result && (
        <View style={styles.resultCard} accessibilityLiveRegion="assertive">
          <Text style={styles.resultTitle}>Migration Complete ✓</Text>
          <View style={styles.statsRow}>
            <Stat label="Total" value={result.total} />
            <Stat label="Migrated" value={result.migrated} color={colors.success} />
            <Stat label="Failed" value={result.failed} color={colors.error} />
            <Stat label="Skipped" value={result.skipped} color={colors.warning} />
          </View>
          <Text style={styles.duration}>Duration: {formatDuration(result.durationMs)}</Text>

          {result.failed > 0 && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={retryFailed}
              disabled={isRetrying}
              accessibilityRole="button"
              accessibilityLabel="Retry failed records"
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.secondaryButtonText}>Retry {result.failed} Failed</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.ghostButton}
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Start a new migration"
          >
            <Text style={styles.ghostButtonText}>Start New Migration</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ---- ERROR ---- */}
      {state === 'error' && (
        <View style={styles.errorCard} accessibilityLiveRegion="assertive">
          <Text style={styles.errorTitle}>Migration Failed</Text>
          <Text style={styles.errorMessage}>{errorMsg}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={startMigration}
            accessibilityRole="button"
            accessibilityLabel="Resume migration"
          >
            <Text style={styles.primaryButtonText}>Resume Migration</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostButton}
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Cancel and go back"
          >
            <Text style={styles.ghostButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.statValue, color ? { color } : undefined]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const colors = {
  primary: '#4A90A4',
  success: '#2E7D32',
  error: '#B42318',
  warning: '#B54708',
  text: '#1A1A1A',
  muted: '#666',
  border: '#E0E0E0',
  cardBg: '#F4F8F9',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 6 },
  subtitle: { fontSize: 14, color: colors.muted, marginBottom: 32, lineHeight: 20 },

  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },

  secondaryButton: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '600', fontSize: 15 },

  ghostButton: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  ghostButtonText: { color: colors.muted, fontSize: 14 },

  spinner: { marginVertical: 24 },
  hint: { textAlign: 'center', color: colors.muted, marginTop: 8 },

  progressCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 10,
    padding: 20,
    marginTop: 8,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressPct: {
    textAlign: 'right',
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 16,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  eta: { textAlign: 'center', fontSize: 13, color: colors.muted },

  resultCard: {
    backgroundColor: '#F0F9F0',
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  resultTitle: { fontSize: 18, fontWeight: '700', color: colors.success, marginBottom: 16 },
  duration: { textAlign: 'center', fontSize: 13, color: colors.muted, marginTop: 4 },

  errorCard: {
    backgroundColor: '#FFF5F5',
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorTitle: { fontSize: 18, fontWeight: '700', color: colors.error, marginBottom: 8 },
  errorMessage: { fontSize: 14, color: colors.error, marginBottom: 20, lineHeight: 20 },
});
