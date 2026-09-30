/**
 * keyRotationService.test.ts — #954 key rotation with rollback and recovery
 *
 * Tests cover:
 *  - startRotation: happy path — all stages execute in order
 *  - startRotation: checkpoint is written after each stage
 *  - startRotation: stage failure stops execution and reports correct failedStage
 *  - resumeRotation: resumes from last successful checkpoint
 *  - resumeRotation: returns error when no checkpoint exists
 *  - rollbackRotation: cleans up pending key and clears checkpoint
 *  - rollbackRotation: returns canRollback:false when rotation is complete
 *  - rollbackRotation: returns canRollback:false when no checkpoint
 *  - buildRecoveryPlan: correct title, steps, and canResume/canRollback for every stage
 *  - injectFailureAtStage: failure injection used by CI / integration tests
 *  - Dual-read window: old key is not revoked until REVOKE_OLD_KEY stage
 *
 * Platform notes: all tests run in the Node test environment with mocked
 * SecureStore, multisigService, keyBackupService, and stellarAccountService.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/keyBackupService', () => ({
  __esModule: true,
  default: {
    generateMnemonic: jest
      .fn()
      .mockResolvedValue(
        'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
      ),
    createBackupWithPin: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/multisigService', () => ({
  __esModule: true,
  default: {
    requestKeyRotation: jest.fn().mockResolvedValue(undefined),
    notifyCoSignRequest: jest.fn().mockResolvedValue(undefined),
    getPendingTransactions: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../services/stellarAccountService', () => ({
  clearSecret: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as SecureStore from 'expo-secure-store';
import keyBackupService from '../../services/keyBackupService';
import multisigService from '../../services/multisigService';
import { clearSecret } from '../../services/stellarAccountService';

import {
  startRotation,
  resumeRotation,
  rollbackRotation,
  loadCheckpoint,
  clearCheckpoint,
  buildRecoveryPlan,
  ROTATION_STAGES,
  type RotationStage,
  type StageResult,
} from '../keyRotationService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockKeyBackup = keyBackupService as jest.Mocked<typeof keyBackupService>;
const mockMultisig = multisigService as jest.Mocked<typeof multisigService>;
const mockClearSecret = clearSecret as jest.MockedFunction<typeof clearSecret>;

const CHECKPOINT_KEY = 'com.petchain.keyRotation.checkpoint';
const PENDING_MNEMONIC_KEY = 'com.petchain.keyRotation.pendingMnemonic';

const TEST_MNEMONIC = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';

const DEFAULT_PARAMS = {
  jointOwnershipId: 'joint-1',
  oldPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  newPublicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  currentUserId: 'user-1',
  petName: 'Buddy',
};

/** Storage state mimic for SecureStore */
let secureStoreData: Record<string, string> = {};

function setupSecureStore() {
  secureStoreData = {};

  mockSecureStore.getItemAsync.mockImplementation(async (key: string) => {
    return secureStoreData[key] ?? null;
  });

  mockSecureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    secureStoreData[key] = value;
  });

  mockSecureStore.deleteItemAsync.mockImplementation(async (key: string) => {
    delete secureStoreData[key];
  });

  // Make the mnemonic available after GENERATE_NEW_KEY
  mockKeyBackup.generateMnemonic.mockImplementation(async () => {
    secureStoreData[PENDING_MNEMONIC_KEY] = TEST_MNEMONIC;
    return TEST_MNEMONIC;
  });
}

function collectStageUpdates(onStageUpdate: ((result: StageResult) => void) | undefined) {
  const updates: StageResult[] = [];
  return {
    onStageUpdate: (result: StageResult) => {
      updates.push(result);
      onStageUpdate?.(result);
    },
    updates,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  setupSecureStore();
});

// ── startRotation — happy path ────────────────────────────────────────────────

describe('startRotation — happy path', () => {
  it('returns success:true when all stages complete', async () => {
    const result = await startRotation(DEFAULT_PARAMS);
    expect(result.success).toBe(true);
    expect(result.completedStages).toEqual(ROTATION_STAGES);
    expect(result.failedStage).toBeUndefined();
  });

  it('executes all four stages in order', async () => {
    const { onStageUpdate, updates } = collectStageUpdates(undefined);
    await startRotation({ ...DEFAULT_PARAMS, onStageUpdate });

    const completedStages = updates.filter((u) => u.status === 'complete').map((u) => u.stage);

    expect(completedStages).toEqual(ROTATION_STAGES);
  });

  it('calls generateMnemonic during GENERATE_NEW_KEY', async () => {
    await startRotation(DEFAULT_PARAMS);
    expect(mockKeyBackup.generateMnemonic).toHaveBeenCalledTimes(1);
  });

  it('calls requestKeyRotation during UPDATE_SIGNERS', async () => {
    await startRotation(DEFAULT_PARAMS);
    expect(mockMultisig.requestKeyRotation).toHaveBeenCalledWith(
      expect.objectContaining({
        jointOwnershipId: DEFAULT_PARAMS.jointOwnershipId,
        oldPublicKey: DEFAULT_PARAMS.oldPublicKey,
        newPublicKey: DEFAULT_PARAMS.newPublicKey,
      }),
    );
  });

  it('calls createBackupWithPin during BACKUP_NEW_KEY', async () => {
    await startRotation(DEFAULT_PARAMS);
    expect(mockKeyBackup.createBackupWithPin).toHaveBeenCalledWith(
      TEST_MNEMONIC,
      DEFAULT_PARAMS.currentUserId,
    );
  });

  it('calls clearSecret during REVOKE_OLD_KEY', async () => {
    await startRotation(DEFAULT_PARAMS);
    expect(mockClearSecret).toHaveBeenCalledTimes(1);
  });

  it('clears the checkpoint on successful completion', async () => {
    await startRotation(DEFAULT_PARAMS);
    expect(secureStoreData[CHECKPOINT_KEY]).toBeUndefined();
  });
});

// ── startRotation — checkpointing ────────────────────────────────────────────

describe('startRotation — checkpointing', () => {
  it('saves a checkpoint before the first stage', async () => {
    let checkpointSavedBeforeCompletion = false;

    mockKeyBackup.generateMnemonic.mockImplementationOnce(async () => {
      // Checkpoint should already exist by the time GENERATE_NEW_KEY runs
      if (secureStoreData[CHECKPOINT_KEY]) {
        checkpointSavedBeforeCompletion = true;
      }
      secureStoreData[PENDING_MNEMONIC_KEY] = TEST_MNEMONIC;
      return TEST_MNEMONIC;
    });

    await startRotation(DEFAULT_PARAMS);
    expect(checkpointSavedBeforeCompletion).toBe(true);
  });

  it('updates lastCompletedStage after each stage', async () => {
    const stageCheckpoints: (RotationStage | null)[] = [];

    const stageIndex = 0;
    const stageImpls = [
      async () => {
        secureStoreData[PENDING_MNEMONIC_KEY] = TEST_MNEMONIC;
        return TEST_MNEMONIC;
      },
      async () => {},
      async () => {},
      async () => {},
    ];

    mockKeyBackup.generateMnemonic.mockImplementation(stageImpls[0]);

    // After each setItemAsync for checkpoint, capture the lastCompletedStage
    mockSecureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
      secureStoreData[key] = value;
      if (key === CHECKPOINT_KEY) {
        try {
          const cp = JSON.parse(value);
          stageCheckpoints.push(cp.lastCompletedStage);
        } catch (error) {
          void error;
        }
      }
    });

    await startRotation(DEFAULT_PARAMS);

    // Should have checkpoint updates for each of the 4 stages
    const nonNullCheckpoints = stageCheckpoints.filter(Boolean);
    expect(nonNullCheckpoints.length).toBeGreaterThanOrEqual(4);
    expect(nonNullCheckpoints).toContain('GENERATE_NEW_KEY');
    expect(nonNullCheckpoints).toContain('REVOKE_OLD_KEY');
  });
});

// ── startRotation — failure injection ────────────────────────────────────────

describe('startRotation — failure injection (injectFailureAtStage)', () => {
  it.each([0, 1, 2, 3])(
    'reports the correct failedStage when stage %i is injected',
    async (stageIndex) => {
      const result = await startRotation({
        ...DEFAULT_PARAMS,
        injectFailureAtStage: stageIndex,
      });

      expect(result.success).toBe(false);
      expect(result.failedStage).toBe(ROTATION_STAGES[stageIndex]);
      expect(result.error).toMatch(/Injected failure at stage/);
    },
  );

  it('stops after the failing stage — subsequent stages are not executed', async () => {
    // Inject failure at stage 1 (UPDATE_SIGNERS)
    await startRotation({ ...DEFAULT_PARAMS, injectFailureAtStage: 1 });

    // Stage 0 ran, stages 2 and 3 should NOT have run
    expect(mockKeyBackup.createBackupWithPin).not.toHaveBeenCalled();
    expect(mockClearSecret).not.toHaveBeenCalled();
  });

  it('completedStages contains only the stages before the failure', async () => {
    const result = await startRotation({ ...DEFAULT_PARAMS, injectFailureAtStage: 2 });

    expect(result.completedStages).toEqual(['GENERATE_NEW_KEY', 'UPDATE_SIGNERS']);
  });
});

// ── dual-read window ──────────────────────────────────────────────────────────

describe('dual-read window — old key stays active until REVOKE_OLD_KEY', () => {
  it('does not call clearSecret if rotation fails before REVOKE_OLD_KEY', async () => {
    await startRotation({ ...DEFAULT_PARAMS, injectFailureAtStage: 2 }); // fail at BACKUP
    expect(mockClearSecret).not.toHaveBeenCalled();
  });

  it('calls clearSecret only when REVOKE_OLD_KEY stage runs', async () => {
    await startRotation(DEFAULT_PARAMS);
    // clearSecret must be called exactly once, at the final stage
    expect(mockClearSecret).toHaveBeenCalledTimes(1);
  });
});

// ── resumeRotation ────────────────────────────────────────────────────────────

describe('resumeRotation', () => {
  it('returns error result when no checkpoint exists', async () => {
    const result = await resumeRotation({ petName: 'Buddy' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No interrupted rotation/);
  });

  it('resumes from the stage after lastCompletedStage', async () => {
    // Simulate a checkpoint saved after GENERATE_NEW_KEY
    const checkpoint = {
      ...DEFAULT_PARAMS,
      lastCompletedStage: 'GENERATE_NEW_KEY',
      startedAt: new Date().toISOString(),
    };
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);
    secureStoreData[PENDING_MNEMONIC_KEY] = TEST_MNEMONIC;

    const result = await resumeRotation({ petName: 'Buddy' });

    expect(result.success).toBe(true);
    // GENERATE_NEW_KEY was already done — only UPDATE_SIGNERS, BACKUP_NEW_KEY, REVOKE_OLD_KEY ran
    expect(mockKeyBackup.generateMnemonic).not.toHaveBeenCalled();
    expect(mockMultisig.requestKeyRotation).toHaveBeenCalled();
    expect(mockKeyBackup.createBackupWithPin).toHaveBeenCalled();
    expect(mockClearSecret).toHaveBeenCalled();
  });

  it('resumes from stage 0 if lastCompletedStage is null', async () => {
    const checkpoint = {
      ...DEFAULT_PARAMS,
      lastCompletedStage: null,
      startedAt: new Date().toISOString(),
    };
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);

    const result = await resumeRotation({ petName: 'Buddy' });

    expect(result.success).toBe(true);
    expect(mockKeyBackup.generateMnemonic).toHaveBeenCalled();
  });
});

// ── rollbackRotation ─────────────────────────────────────────────────────────

describe('rollbackRotation', () => {
  it('returns canRollback:false when no checkpoint exists', async () => {
    const result = await rollbackRotation();
    expect(result.canRollback).toBe(false);
    expect(result.message).toMatch(/No rotation in progress/);
  });

  it('returns canRollback:false after REVOKE_OLD_KEY (too late)', async () => {
    const checkpoint = {
      ...DEFAULT_PARAMS,
      lastCompletedStage: 'REVOKE_OLD_KEY',
      startedAt: new Date().toISOString(),
    };
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);

    const result = await rollbackRotation();
    expect(result.canRollback).toBe(false);
    expect(result.message).toMatch(/old key has already been revoked/i);
  });

  it('deletes the pending mnemonic key from SecureStore', async () => {
    const checkpoint = {
      ...DEFAULT_PARAMS,
      lastCompletedStage: 'GENERATE_NEW_KEY',
      startedAt: new Date().toISOString(),
    };
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);
    secureStoreData[PENDING_MNEMONIC_KEY] = TEST_MNEMONIC;

    await rollbackRotation();

    expect(secureStoreData[PENDING_MNEMONIC_KEY]).toBeUndefined();
  });

  it('clears the checkpoint after rollback', async () => {
    const checkpoint = {
      ...DEFAULT_PARAMS,
      lastCompletedStage: 'GENERATE_NEW_KEY',
      startedAt: new Date().toISOString(),
    };
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);

    await rollbackRotation();

    expect(secureStoreData[CHECKPOINT_KEY]).toBeUndefined();
  });

  it('attempts to reverse signer update after UPDATE_SIGNERS stage', async () => {
    const checkpoint = {
      ...DEFAULT_PARAMS,
      lastCompletedStage: 'UPDATE_SIGNERS',
      startedAt: new Date().toISOString(),
    };
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);

    await rollbackRotation();

    // Should call requestKeyRotation with reversed keys
    expect(mockMultisig.requestKeyRotation).toHaveBeenCalledWith(
      expect.objectContaining({
        oldPublicKey: DEFAULT_PARAMS.newPublicKey,
        newPublicKey: DEFAULT_PARAMS.oldPublicKey,
      }),
    );
  });

  it('returns canRollback:true for stages before REVOKE_OLD_KEY', async () => {
    for (const stage of ['GENERATE_NEW_KEY', 'UPDATE_SIGNERS', 'BACKUP_NEW_KEY'] as const) {
      setupSecureStore();

      const checkpoint = {
        ...DEFAULT_PARAMS,
        lastCompletedStage: stage,
        startedAt: new Date().toISOString(),
      };
      secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);

      const result = await rollbackRotation();
      expect(result.canRollback).toBe(true);
    }
  });
});

// ── buildRecoveryPlan ─────────────────────────────────────────────────────────

describe('buildRecoveryPlan', () => {
  it('returns canResume:false and canRollback:false for null (no progress)', () => {
    const plan = buildRecoveryPlan(null);
    expect(plan.canResume).toBe(false);
    expect(plan.canRollback).toBe(false);
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('returns canResume:true and canRollback:true after GENERATE_NEW_KEY', () => {
    const plan = buildRecoveryPlan('GENERATE_NEW_KEY');
    expect(plan.canResume).toBe(true);
    expect(plan.canRollback).toBe(true);
  });

  it('returns canResume:true and canRollback:true after UPDATE_SIGNERS', () => {
    const plan = buildRecoveryPlan('UPDATE_SIGNERS');
    expect(plan.canResume).toBe(true);
    expect(plan.canRollback).toBe(true);
  });

  it('returns canResume:true and canRollback:true after BACKUP_NEW_KEY', () => {
    const plan = buildRecoveryPlan('BACKUP_NEW_KEY');
    expect(plan.canResume).toBe(true);
    expect(plan.canRollback).toBe(true);
  });

  it('returns canResume:false and canRollback:false after REVOKE_OLD_KEY (complete)', () => {
    const plan = buildRecoveryPlan('REVOKE_OLD_KEY');
    expect(plan.canResume).toBe(false);
    expect(plan.canRollback).toBe(false);
  });

  it.each([
    null,
    'GENERATE_NEW_KEY',
    'UPDATE_SIGNERS',
    'BACKUP_NEW_KEY',
    'REVOKE_OLD_KEY',
  ] as const)('has a non-empty title and steps for every stage (%s)', (stage) => {
    const plan = buildRecoveryPlan(stage as RotationStage | null);
    expect(plan.title.length).toBeGreaterThan(0);
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});

// ── loadCheckpoint / clearCheckpoint ─────────────────────────────────────────

describe('loadCheckpoint / clearCheckpoint', () => {
  it('loadCheckpoint returns null when no checkpoint is stored', async () => {
    const cp = await loadCheckpoint();
    expect(cp).toBeNull();
  });

  it('loadCheckpoint returns the stored checkpoint', async () => {
    const checkpoint = {
      ...DEFAULT_PARAMS,
      lastCompletedStage: 'GENERATE_NEW_KEY' as RotationStage,
      startedAt: new Date().toISOString(),
    };
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify(checkpoint);

    const cp = await loadCheckpoint();
    expect(cp).not.toBeNull();
    if (cp) {
      expect(cp.lastCompletedStage).toBe('GENERATE_NEW_KEY');
    }
  });

  it('clearCheckpoint removes the stored checkpoint', async () => {
    secureStoreData[CHECKPOINT_KEY] = JSON.stringify({ foo: 'bar' });
    await clearCheckpoint();
    expect(secureStoreData[CHECKPOINT_KEY]).toBeUndefined();
  });
});
