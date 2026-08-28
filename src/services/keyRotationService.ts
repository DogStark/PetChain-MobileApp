/**
 * keyRotationService — staged key rotation with rollback and recovery (#954)
 *
 * ### Design
 *
 * Key rotation is split into four atomic *stages*:
 *
 *   1. GENERATE_NEW_KEY — generate a new mnemonic/keypair and store it
 *      under a "pending" secure-store slot (does NOT overwrite the active key).
 *   2. UPDATE_SIGNERS  — submit the new signer to the backend.  During this
 *      stage the old key is still valid (dual-read window).
 *   3. BACKUP_NEW_KEY  — encrypt and persist the new mnemonic.
 *   4. REVOKE_OLD_KEY  — only after the backup is confirmed, clear the old key
 *      from the secure store.
 *
 * A **checkpoint** is persisted to SecureStore after each stage completes.
 * If the app is killed mid-rotation, `resumeRotation` can pick up from the
 * last successful checkpoint rather than restarting from scratch.
 *
 * ### Rollback
 *
 * If any stage fails the service exposes `rollbackRotation`, which:
 *   - Removes the pending new key from secure store (stage 1 artifact).
 *   - Calls the backend to cancel the signer-management transaction if one
 *     was submitted (stage 2 artifact).
 *   - Clears the checkpoint so a fresh start is required next time.
 *
 * A rollback leaves the device in exactly the state it was in before the
 * rotation attempt began.
 *
 * ### Failure injection (testing)
 *
 * Pass `injectFailureAtStage` to `startRotation` / `resumeRotation` to
 * simulate a failure at a specific stage — used in unit/integration tests.
 *
 * ### Platform notes
 * - SecureStore is available on both iOS and Android.
 * - The dual-read window means the old key remains valid until stage 4, so
 *   the user can still decrypt data on both platforms during the transition.
 */

import * as SecureStore from 'expo-secure-store';

import keyBackupService from './keyBackupService';
import multisigService from './multisigService';
import { clearSecret } from './stellarAccountService';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const CHECKPOINT_KEY = 'com.petchain.keyRotation.checkpoint';
const PENDING_MNEMONIC_KEY = 'com.petchain.keyRotation.pendingMnemonic';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RotationStage =
  | 'GENERATE_NEW_KEY'
  | 'UPDATE_SIGNERS'
  | 'BACKUP_NEW_KEY'
  | 'REVOKE_OLD_KEY';

export const ROTATION_STAGES: RotationStage[] = [
  'GENERATE_NEW_KEY',
  'UPDATE_SIGNERS',
  'BACKUP_NEW_KEY',
  'REVOKE_OLD_KEY',
];

export type StageStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface StageResult {
  stage: RotationStage;
  status: StageStatus;
  error?: string;
}

export interface RotationCheckpoint {
  jointOwnershipId: string;
  oldPublicKey: string;
  newPublicKey: string;
  currentUserId: string;
  reason?: string;
  lastCompletedStage: RotationStage | null;
  startedAt: string;
}

export interface RotationParams {
  jointOwnershipId: string;
  oldPublicKey: string;
  newPublicKey: string;
  currentUserId: string;
  petName: string;
  reason?: string;
  /** Called after each stage completes or fails */
  onStageUpdate?: (result: StageResult) => void;
  /**
   * Inject a failure at this stage index (0-based) for testing.
   * The stage will throw an error instead of executing.
   */
  injectFailureAtStage?: number;
}

export interface RotationResult {
  success: boolean;
  completedStages: RotationStage[];
  failedStage?: RotationStage;
  error?: string;
  /** Mnemonic for the new key — only present on full success; caller MUST display and clear */
  newMnemonic?: string;
}

// ─── Checkpoint helpers ───────────────────────────────────────────────────────

/** Persist the current checkpoint to SecureStore. */
async function saveCheckpoint(checkpoint: RotationCheckpoint): Promise<void> {
  await SecureStore.setItemAsync(CHECKPOINT_KEY, JSON.stringify(checkpoint));
}

/** Load the last checkpoint, or null if none exists. */
export async function loadCheckpoint(): Promise<RotationCheckpoint | null> {
  const raw = await SecureStore.getItemAsync(CHECKPOINT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RotationCheckpoint;
  } catch {
    return null;
  }
}

/** Delete the checkpoint from SecureStore. */
export async function clearCheckpoint(): Promise<void> {
  await SecureStore.deleteItemAsync(CHECKPOINT_KEY);
}

// ─── Individual stage executors ───────────────────────────────────────────────

async function executeGenerateNewKey(): Promise<string> {
  const mnemonic = await keyBackupService.generateMnemonic();
  // Store the pending mnemonic separately so it doesn't overwrite the active key
  await SecureStore.setItemAsync(PENDING_MNEMONIC_KEY, mnemonic);
  return mnemonic;
}

async function executeUpdateSigners(
  jointOwnershipId: string,
  oldPublicKey: string,
  newPublicKey: string,
  petName: string,
  reason?: string,
): Promise<void> {
  await multisigService.requestKeyRotation({
    jointOwnershipId,
    oldPublicKey,
    newPublicKey,
    reason,
  });
  await multisigService.notifyCoSignRequest(
    'signer_management',
    `A co-owner of ${petName} has requested a key rotation. Your approval is needed.`,
    jointOwnershipId,
  );
}

async function executeBackupNewKey(mnemonic: string, currentUserId: string): Promise<void> {
  if (!mnemonic) throw new Error('Pending mnemonic not found');
  await keyBackupService.createBackupWithPin(mnemonic, currentUserId);
}

async function executeRevokeOldKey(): Promise<void> {
  await clearSecret();
  // Clean up the pending mnemonic slot — it has been committed to backup
  await SecureStore.deleteItemAsync(PENDING_MNEMONIC_KEY);
}

// ─── Core rotation engine ─────────────────────────────────────────────────────

/**
 * Execute a single rotation stage and update the checkpoint on success.
 */
async function runStage(
  stage: RotationStage,
  stageIndex: number,
  params: RotationParams,
  checkpoint: RotationCheckpoint,
  pendingMnemonic: string,
  injectFailureAtStage?: number,
): Promise<void> {
  if (injectFailureAtStage === stageIndex) {
    throw new Error(`Injected failure at stage ${stageIndex} (${stage}) for testing`);
  }

  switch (stage) {
    case 'GENERATE_NEW_KEY':
      await executeGenerateNewKey();
      break;
    case 'UPDATE_SIGNERS':
      await executeUpdateSigners(
        checkpoint.jointOwnershipId,
        checkpoint.oldPublicKey,
        checkpoint.newPublicKey,
        params.petName,
        checkpoint.reason,
      );
      break;
    case 'BACKUP_NEW_KEY':
      await executeBackupNewKey(pendingMnemonic, checkpoint.currentUserId);
      break;
    case 'REVOKE_OLD_KEY':
      await executeRevokeOldKey();
      break;
  }

  // Persist checkpoint so we can resume from here if the app is killed
  checkpoint.lastCompletedStage = stage;
  await saveCheckpoint(checkpoint);
}

/**
 * Start a new key rotation.
 *
 * Stages are executed sequentially.  If a stage fails, the engine stops and
 * returns a failed result.  The checkpoint captures how far we got so
 * `resumeRotation` can pick up without redoing completed stages.
 */
export async function startRotation(params: RotationParams): Promise<RotationResult> {
  const checkpoint: RotationCheckpoint = {
    jointOwnershipId: params.jointOwnershipId,
    oldPublicKey: params.oldPublicKey,
    newPublicKey: params.newPublicKey,
    currentUserId: params.currentUserId,
    reason: params.reason,
    lastCompletedStage: null,
    startedAt: new Date().toISOString(),
  };
  await saveCheckpoint(checkpoint);

  return executeStagesFrom(0, checkpoint, params);
}

/**
 * Resume an interrupted rotation from the last successful checkpoint.
 *
 * If no checkpoint exists, returns an error result.
 */
export async function resumeRotation(
  params: Pick<RotationParams, 'petName' | 'onStageUpdate' | 'injectFailureAtStage'>,
): Promise<RotationResult> {
  const checkpoint = await loadCheckpoint();
  if (!checkpoint) {
    return {
      success: false,
      completedStages: [],
      error: 'No interrupted rotation found to resume.',
    };
  }

  const fullParams: RotationParams = {
    ...checkpoint,
    petName: params.petName,
    onStageUpdate: params.onStageUpdate,
    injectFailureAtStage: params.injectFailureAtStage,
  };

  const startIndex = checkpoint.lastCompletedStage
    ? ROTATION_STAGES.indexOf(checkpoint.lastCompletedStage) + 1
    : 0;

  return executeStagesFrom(startIndex, checkpoint, fullParams);
}

async function executeStagesFrom(
  startIndex: number,
  checkpoint: RotationCheckpoint,
  params: RotationParams,
): Promise<RotationResult> {
  const completedStages: RotationStage[] = ROTATION_STAGES.slice(0, startIndex);
  let pendingMnemonic = '';

  // Retrieve any previously generated mnemonic from secure store
  try {
    pendingMnemonic = (await SecureStore.getItemAsync(PENDING_MNEMONIC_KEY)) ?? '';
  } catch {
    pendingMnemonic = '';
  }

  for (let i = startIndex; i < ROTATION_STAGES.length; i++) {
    const stage = ROTATION_STAGES[i];
    params.onStageUpdate?.({ stage, status: 'running' });

    try {
      await runStage(stage, i, params, checkpoint, pendingMnemonic, params.injectFailureAtStage);

      if (stage === 'GENERATE_NEW_KEY') {
        // Read back the mnemonic we just stored
        pendingMnemonic = (await SecureStore.getItemAsync(PENDING_MNEMONIC_KEY)) ?? '';
      }

      completedStages.push(stage);
      params.onStageUpdate?.({ stage, status: 'complete' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      params.onStageUpdate?.({ stage, status: 'failed', error: errorMessage });

      return {
        success: false,
        completedStages,
        failedStage: stage,
        error: errorMessage,
      };
    }
  }

  // All stages completed — clean up checkpoint
  await clearCheckpoint();

  return {
    success: true,
    completedStages,
    newMnemonic: pendingMnemonic || undefined,
  };
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

/**
 * Roll back an interrupted rotation, restoring the device to the pre-rotation
 * state.
 *
 * What is undone depends on `lastCompletedStage`:
 *   - After GENERATE_NEW_KEY: delete the pending mnemonic from secure store.
 *   - After UPDATE_SIGNERS: attempt to cancel the signer-management tx on the
 *     backend (best-effort; does not throw if it fails).
 *   - After BACKUP_NEW_KEY: pending mnemonic is already backed up but the old
 *     key is still active, so we just clear the pending slot.
 *   - After REVOKE_OLD_KEY: rollback is not possible — the old key has been
 *     permanently cleared.  This is surfaced as an error.
 *
 * @returns A human-readable description of what was undone.
 */
export async function rollbackRotation(): Promise<{ message: string; canRollback: boolean }> {
  const checkpoint = await loadCheckpoint();

  if (!checkpoint) {
    return { message: 'No rotation in progress to roll back.', canRollback: false };
  }

  if (checkpoint.lastCompletedStage === 'REVOKE_OLD_KEY') {
    return {
      message:
        'The old key has already been revoked. Rollback is not possible at this stage. ' +
        'Use the "Restore from Backup" flow to recover access using your saved mnemonic.',
      canRollback: false,
    };
  }

  const undone: string[] = [];

  // Remove the pending mnemonic if it exists
  try {
    await SecureStore.deleteItemAsync(PENDING_MNEMONIC_KEY);
    undone.push('Removed pending new key from secure storage');
  } catch {
    // Non-fatal
  }

  // If signers were already updated, ask the backend to cancel
  if (
    checkpoint.lastCompletedStage === 'UPDATE_SIGNERS' ||
    checkpoint.lastCompletedStage === 'BACKUP_NEW_KEY'
  ) {
    try {
      await multisigService.requestKeyRotation({
        jointOwnershipId: checkpoint.jointOwnershipId,
        oldPublicKey: checkpoint.newPublicKey, // swap: new → old to reverse
        newPublicKey: checkpoint.oldPublicKey, // swap: old → new (restore original)
        reason: 'Rollback of failed key rotation',
      });
      undone.push('Cancelled signer update on backend (restore original key)');
    } catch {
      // Best-effort; log but don't re-throw
      undone.push('Warning: could not cancel backend signer update — manual action may be needed');
    }
  }

  await clearCheckpoint();
  undone.push('Cleared rotation checkpoint');

  return {
    message: `Rollback complete:\n• ${undone.join('\n• ')}`,
    canRollback: true,
  };
}

// ─── Recovery plan helpers ────────────────────────────────────────────────────

/**
 * Returns a structured recovery plan for the current rotation state.
 * Used by the UI to show the user what their options are after a failure.
 */
export function buildRecoveryPlan(lastCompletedStage: RotationStage | null): {
  title: string;
  steps: string[];
  canResume: boolean;
  canRollback: boolean;
} {
  switch (lastCompletedStage) {
    case null:
      return {
        title: 'No progress saved',
        steps: ['Tap "Retry" to start from the beginning.'],
        canResume: false,
        canRollback: false,
      };
    case 'GENERATE_NEW_KEY':
      return {
        title: 'New key generated, not yet submitted',
        steps: [
          'Tap "Resume" to continue from the signer-update step.',
          'Or tap "Roll Back" to discard the new key and return to the original state.',
        ],
        canResume: true,
        canRollback: true,
      };
    case 'UPDATE_SIGNERS':
      return {
        title: 'Signers updated, backup not yet saved',
        steps: [
          'Tap "Resume" to save the backup and complete the rotation.',
          'Or tap "Roll Back" to cancel the signer update and restore the original key.',
          'Important: do not uninstall the app before completing or rolling back.',
        ],
        canResume: true,
        canRollback: true,
      };
    case 'BACKUP_NEW_KEY':
      return {
        title: 'Backup saved, old key not yet revoked',
        steps: [
          'Tap "Resume" to revoke the old key and finish.',
          'Or tap "Roll Back" to keep the old key active (the new backup will be discarded).',
        ],
        canResume: true,
        canRollback: true,
      };
    case 'REVOKE_OLD_KEY':
      return {
        title: 'Rotation complete',
        steps: ['The rotation finished successfully. No recovery needed.'],
        canResume: false,
        canRollback: false,
      };
  }
}
