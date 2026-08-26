/**
 * KeyRotationScreen — key rotation with rollback and recovery (#954)
 *
 * ### Changes in this version
 *
 * The screen now delegates all rotation logic to `keyRotationService`, which
 * provides:
 *   - **Staged rotation** — four atomic steps with individual retry on failure.
 *   - **Checkpointing** — progress is persisted to SecureStore after each step
 *     so the rotation can be resumed if the app is killed mid-flight.
 *   - **Dual-read window** — the old key remains active until the final
 *     `REVOKE_OLD_KEY` stage so the user can still decrypt existing data during
 *     the transition on both iOS and Android.
 *   - **Rollback** — a "Roll Back" button is shown after any failure so the
 *     user can restore the device to the pre-rotation state.
 *   - **Recovery plan** — a human-readable explanation of the next steps is
 *     shown after every failure.
 *
 * ### Guard flow (unchanged)
 *   1. Validate the new public key.
 *   2. Check for pending co-sign requests (block if any exist).
 *   3. Require biometric re-authentication.
 *   4. Run the staged rotation via `keyRotationService.startRotation`.
 *
 * ### Resume
 *
 * On mount the screen checks `keyRotationService.loadCheckpoint`.  If an
 * interrupted rotation is found the user is offered "Resume" as the primary
 * action so they don't have to re-enter details.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { authenticateWithBiometric } from '../services/authService';
import {
  ROTATION_STAGES,
  buildRecoveryPlan,
  clearCheckpoint,
  loadCheckpoint,
  resumeRotation,
  rollbackRotation,
  startRotation,
  type RotationCheckpoint,
  type RotationStage,
  type StageResult,
  type StageStatus,
} from '../services/keyRotationService';
import multisigService, { type PendingTransactionResponse } from '../services/multisigService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  jointOwnershipId: string;
  petName: string;
  currentPublicKey: string;
  currentUserId: string;
  onBack: () => void;
  onRotationComplete: () => void;
}

type Phase =
  | 'form'
  | 'checking'
  | 'blocked'
  | 'biometric'
  | 'rotating'
  | 'failed'
  | 'rolling_back'
  | 'done';

interface StepDisplay {
  label: string;
  status: StageStatus;
  error?: string;
}

const STEP_LABELS: Record<RotationStage, string> = {
  GENERATE_NEW_KEY: 'Generate new keypair',
  UPDATE_SIGNERS: 'Update on-chain signers',
  BACKUP_NEW_KEY: 'Backup new key',
  REVOKE_OLD_KEY: 'Revoke old key',
};

function makeSteps(): StepDisplay[] {
  return ROTATION_STAGES.map((stage) => ({ label: STEP_LABELS[stage], status: 'pending' }));
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const KeyRotationScreen: React.FC<Props> = ({
  jointOwnershipId,
  petName,
  currentPublicKey,
  currentUserId,
  onBack,
  onRotationComplete,
}) => {
  const [newPublicKey, setNewPublicKey] = useState('');
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [pendingRequests, setPendingRequests] = useState<PendingTransactionResponse[]>([]);
  const [steps, setSteps] = useState<StepDisplay[]>(makeSteps());
  const [failedStage, setFailedStage] = useState<RotationStage | null>(null);
  const [failureError, setFailureError] = useState<string>('');
  const [recoveryPlan, setRecoveryPlan] = useState<ReturnType<typeof buildRecoveryPlan> | null>(
    null,
  );
  const [resumableCheckpoint, setResumableCheckpoint] = useState<RotationCheckpoint | null>(null);

  // ── Check for a resumable checkpoint on mount ─────────────────────────────
  useEffect(() => {
    loadCheckpoint()
      .then((cp) => {
        if (cp && cp.lastCompletedStage !== 'REVOKE_OLD_KEY') {
          setResumableCheckpoint(cp);
        }
      })
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  const isValidStellarKey = (key: string) => /^G[A-Z2-7]{55}$/.test(key.trim());

  // ── Step display helpers ──────────────────────────────────────────────────

  function updateStep(stage: RotationStage, status: StageStatus, error?: string) {
    const index = ROTATION_STAGES.indexOf(stage);
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, status, error: error ?? s.error } : s)),
    );
  }

  function handleStageUpdate(result: StageResult) {
    updateStep(result.stage, result.status, result.error);
  }

  // ── Rotation execution ────────────────────────────────────────────────────

  async function executeRotation(resume: boolean) {
    setPhase('rotating');
    setSteps(makeSteps());
    setFailedStage(null);
    setFailureError('');
    setRecoveryPlan(null);

    const rotationResult = resume
      ? await resumeRotation({ petName, onStageUpdate: handleStageUpdate })
      : await startRotation({
          jointOwnershipId,
          oldPublicKey: currentPublicKey,
          newPublicKey: newPublicKey.trim(),
          currentUserId,
          petName,
          reason: reason.trim() || undefined,
          onStageUpdate: handleStageUpdate,
        });

    if (rotationResult.success) {
      setPhase('done');
    } else {
      const lastCompleted =
        rotationResult.completedStages.length > 0
          ? rotationResult.completedStages[rotationResult.completedStages.length - 1]
          : null;

      setFailedStage(rotationResult.failedStage ?? null);
      setFailureError(rotationResult.error ?? 'Unknown error');
      setRecoveryPlan(buildRecoveryPlan(lastCompleted));
      setPhase('failed');
    }
  }

  // ── Guard flow ────────────────────────────────────────────────────────────

  async function handleProceed() {
    const trimmedKey = newPublicKey.trim();
    if (!isValidStellarKey(trimmedKey)) {
      Alert.alert('Invalid Key', 'Enter a valid Stellar public key (starts with G, 56 chars).');
      return;
    }
    if (trimmedKey === currentPublicKey) {
      Alert.alert('Same Key', 'The new key must differ from your current key.');
      return;
    }

    setPhase('checking');
    try {
      const pending = await multisigService.getPendingTransactions(jointOwnershipId);
      if (pending.length > 0) {
        setPendingRequests(pending);
        setPhase('blocked');
        return;
      }
    } catch {
      Alert.alert('Warning', 'Could not verify pending co-sign requests. Proceed with caution.', [
        { text: 'Cancel', onPress: () => setPhase('form') },
        { text: 'Continue Anyway', onPress: () => requestBiometric(false) },
      ]);
      return;
    }

    requestBiometric(false);
  }

  async function handleResume() {
    setPhase('biometric');
    const ok = await authenticateWithBiometric();
    if (!ok) {
      Alert.alert(
        'Authentication Failed',
        'Biometric re-authentication is required to resume key rotation.',
      );
      setPhase('form');
      return;
    }
    await executeRotation(true);
  }

  async function requestBiometric(resume: boolean) {
    setPhase('biometric');
    const ok = await authenticateWithBiometric();
    if (!ok) {
      Alert.alert(
        'Authentication Failed',
        'Biometric re-authentication is required to rotate your key.',
      );
      setPhase('form');
      return;
    }
    await executeRotation(resume);
  }

  // ── Rollback ──────────────────────────────────────────────────────────────

  async function handleRollback() {
    Alert.alert(
      'Roll Back Rotation',
      'This will undo all changes made so far and restore your original key. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Roll Back',
          style: 'destructive',
          onPress: async () => {
            setPhase('rolling_back');
            try {
              const result = await rollbackRotation();
              setResumableCheckpoint(null);
              Alert.alert(
                result.canRollback ? 'Rolled Back' : 'Rollback Not Available',
                result.message,
                [{ text: 'OK', onPress: () => setPhase('form') }],
              );
            } catch (err) {
              Alert.alert('Rollback Failed', err instanceof Error ? err.message : String(err));
              setPhase('failed');
            }
          },
        },
      ],
    );
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderStepIcon(status: StageStatus, index: number) {
    if (status === 'complete') return <Text style={styles.stepIconDone}>✓</Text>;
    if (status === 'failed') return <Text style={styles.stepIconError}>✕</Text>;
    if (status === 'running') return <ActivityIndicator size="small" color="#1565c0" />;
    return <Text style={styles.stepIconWaiting}>{index + 1}</Text>;
  }

  // ── Done screen ───────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <View style={styles.container}>
        <View style={styles.doneContainer}>
          <Text style={styles.doneIcon}>🎉</Text>
          <Text style={styles.doneTitle}>Key Rotation Complete</Text>
          <Text style={styles.doneBody}>
            Your new key has been submitted for co-owner approval. The old key has been cleared from
            this device.
          </Text>
          <TouchableOpacity style={styles.submitBtn} onPress={onRotationComplete}>
            <Text style={styles.submitBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          disabled={phase !== 'form' && phase !== 'failed'}
        >
          <Text
            style={[styles.backText, phase !== 'form' && phase !== 'failed' && styles.disabledText]}
          >
            ‹ Back
          </Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Key Rotation</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Pending co-sign modal */}
      <Modal visible={phase === 'blocked'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>⚠️ Pending Approvals</Text>
            <Text style={styles.modalBody}>
              You have {pendingRequests.length} pending co-sign request
              {pendingRequests.length !== 1 ? 's' : ''} that will be{' '}
              <Text style={styles.bold}>invalidated</Text> by a key rotation. Resolve them first:
            </Text>
            {pendingRequests.map((r) => (
              <View key={r.id} style={styles.pendingRow}>
                <Text style={styles.pendingType}>{r.operationType.replace('_', ' ')}</Text>
                <Text style={styles.pendingDesc} numberOfLines={2}>
                  {r.description}
                </Text>
              </View>
            ))}
            <TouchableOpacity style={styles.modalBtn} onPress={() => setPhase('form')}>
              <Text style={styles.modalBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Resumable-rotation banner */}
        {resumableCheckpoint && phase === 'form' && (
          <View style={styles.resumeBanner}>
            <Text style={styles.resumeBannerTitle}>⚡ Interrupted Rotation Found</Text>
            <Text style={styles.resumeBannerBody}>
              A previous rotation was interrupted at the{' '}
              <Text style={styles.bold}>
                {resumableCheckpoint.lastCompletedStage
                  ? STEP_LABELS[resumableCheckpoint.lastCompletedStage]
                  : 'start'}
              </Text>{' '}
              stage. You can resume it or roll it back.
            </Text>
            <View style={styles.resumeActions}>
              <TouchableOpacity style={styles.resumeBtn} onPress={handleResume}>
                <Text style={styles.resumeBtnText}>Resume</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rollbackBtnSmall} onPress={handleRollback}>
                <Text style={styles.rollbackBtnSmallText}>Roll Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step progress (shown during/after rotation) */}
        {(phase === 'rotating' || phase === 'failed' || phase === 'rolling_back') && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {phase === 'rolling_back' ? 'Rolling Back…' : 'Rotation Progress'}
            </Text>
            {phase === 'failed' && (
              <Text style={styles.stepError}>
                Failed at {failedStage ?? 'an unknown stage'}: {failureError}
              </Text>
            )}
            {steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepIconBox}>{renderStepIcon(step.status, i)}</View>
                <View style={styles.stepTextBox}>
                  <Text style={styles.stepLabel}>{step.label}</Text>
                  {step.status === 'failed' && <Text style={styles.stepError}>{step.error}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recovery plan (shown after failure) */}
        {phase === 'failed' && recoveryPlan && (
          <View style={styles.recoveryCard}>
            <Text style={styles.recoveryTitle}>📋 {recoveryPlan.title}</Text>
            {recoveryPlan.steps.map((step, i) => (
              <Text key={i} style={styles.recoveryStep}>
                {'•'} {step}
              </Text>
            ))}
            <View style={styles.recoveryActions}>
              {recoveryPlan.canResume && (
                <TouchableOpacity style={styles.submitBtn} onPress={() => requestBiometric(true)}>
                  <Text style={styles.submitBtnText}>Resume</Text>
                </TouchableOpacity>
              )}
              {recoveryPlan.canRollback && (
                <TouchableOpacity style={styles.rollbackBtn} onPress={handleRollback}>
                  <Text style={styles.rollbackBtnText}>Roll Back</Text>
                </TouchableOpacity>
              )}
              {!recoveryPlan.canResume && !recoveryPlan.canRollback && (
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={() => {
                    clearCheckpoint().catch(() => {});
                    setPhase('form');
                    setSteps(makeSteps());
                  }}
                >
                  <Text style={styles.submitBtnText}>Start Fresh</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Form (shown in form / checking / biometric phases) */}
        {(phase === 'form' || phase === 'checking' || phase === 'biometric') && (
          <>
            <View style={styles.infoBanner}>
              <Text style={styles.infoIcon}>🔄</Text>
              <View style={styles.infoText}>
                <Text style={styles.infoTitle}>Rotate Your Signing Key</Text>
                <Text style={styles.infoBody}>
                  Biometric re-authentication and co-owner approval are required. Progress is
                  checkpointed — if interrupted you can resume without losing work. Any pending
                  co-sign requests will be checked before proceeding.
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current Key</Text>
              <View style={styles.keyBox}>
                <Text style={styles.keyText} numberOfLines={2}>
                  {currentPublicKey}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>New Key Details</Text>

              <Text style={styles.label}>New Stellar Public Key *</Text>
              <TextInput
                style={[styles.input, styles.monoInput]}
                value={newPublicKey}
                onChangeText={setNewPublicKey}
                placeholder="GABC...XYZ (56 characters)"
                autoCapitalize="characters"
                autoCorrect={false}
                placeholderTextColor="#bbb"
                editable={phase === 'form'}
                accessibilityLabel="New Stellar public key"
              />
              {newPublicKey.length > 0 && !isValidStellarKey(newPublicKey) && (
                <Text style={styles.fieldError}>Must start with G and be 56 characters</Text>
              )}

              <Text style={styles.label}>Reason (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Key compromise, hardware upgrade..."
                multiline
                numberOfLines={3}
                placeholderTextColor="#bbb"
                editable={phase === 'form'}
                accessibilityLabel="Rotation reason"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, phase !== 'form' && styles.submitBtnDisabled]}
              onPress={handleProceed}
              disabled={phase !== 'form'}
              accessibilityRole="button"
              accessibilityLabel="Start key rotation"
            >
              {phase === 'checking' || phase === 'biometric' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Rotate Key</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  disabledText: { color: '#bbb' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  headerRight: { width: 60 },
  content: { padding: 16, paddingBottom: 40 },

  // Resumable banner
  resumeBanner: {
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#A5D6A7',
  },
  resumeBannerTitle: { fontSize: 14, fontWeight: '700', color: '#1B5E20', marginBottom: 6 },
  resumeBannerBody: { fontSize: 13, color: '#2E7D32', lineHeight: 18, marginBottom: 10 },
  resumeActions: { flexDirection: 'row', gap: 10 },
  resumeBtn: {
    flex: 1,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  resumeBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rollbackBtnSmall: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F44336',
  },
  rollbackBtnSmallText: { color: '#F44336', fontWeight: '700', fontSize: 13 },

  // Recovery plan
  recoveryCard: {
    backgroundColor: '#FFF3E0',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  recoveryTitle: { fontSize: 14, fontWeight: '700', color: '#E65100', marginBottom: 10 },
  recoveryStep: { fontSize: 13, color: '#5D4037', marginBottom: 4, lineHeight: 18 },
  recoveryActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  rollbackBtn: {
    flex: 1,
    backgroundColor: '#F44336',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  rollbackBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  infoBanner: {
    flexDirection: 'row',
    backgroundColor: '#e3f2fd',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bbdefb',
    gap: 10,
    alignItems: 'flex-start',
  },
  infoIcon: { fontSize: 24 },
  infoText: { flex: 1 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#1565c0', marginBottom: 4 },
  infoBody: { fontSize: 13, color: '#0d47a1', lineHeight: 18 },
  bold: { fontWeight: '700' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  keyBox: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  keyText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: '#333',
    lineHeight: 18,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1a1a1a',
    backgroundColor: '#fafafa',
  },
  monoInput: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12 },
  textArea: { height: 80, textAlignVertical: 'top' },
  fieldError: { fontSize: 11, color: '#F44336', marginTop: 4 },
  submitBtn: {
    flex: 1,
    backgroundColor: '#1565c0',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Step progress
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  stepIconBox: { width: 28, alignItems: 'center', marginRight: 10, paddingTop: 2 },
  stepIconDone: { fontSize: 16, color: '#4CAF50', fontWeight: '700' },
  stepIconError: { fontSize: 16, color: '#F44336', fontWeight: '700' },
  stepIconWaiting: { fontSize: 14, color: '#bbb', fontWeight: '700' },
  stepTextBox: { flex: 1 },
  stepLabel: { fontSize: 14, color: '#1a1a1a' },
  stepError: { fontSize: 12, color: '#F44336', marginTop: 2 },

  // Blocking modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: { backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#c62828', marginBottom: 10 },
  modalBody: { fontSize: 14, color: '#333', marginBottom: 12, lineHeight: 20 },
  pendingRow: {
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ffe082',
  },
  pendingType: { fontSize: 12, fontWeight: '700', color: '#e65100', textTransform: 'capitalize' },
  pendingDesc: { fontSize: 12, color: '#555', marginTop: 2 },
  modalBtn: {
    marginTop: 8,
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Done screen
  doneContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  doneIcon: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  doneBody: { fontSize: 14, color: '#555', lineHeight: 22, textAlign: 'center', marginBottom: 32 },
});

export default KeyRotationScreen;
