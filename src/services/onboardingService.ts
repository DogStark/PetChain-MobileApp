import analyticsService from './analyticsService';
import { type LanguageCode } from '../i18n';
import { encryptedAsyncStorage } from '../utils/encryptedAsyncStorage';

export type OnboardingVariant = 'A' | 'B';

export interface OnboardingState {
  currentStep: number;
  completedSteps: number[];
  skippedSteps: number[];
  variant: OnboardingVariant;
  completed: boolean;
  startedAt: number;
  language?: LanguageCode;
}

const STORAGE_KEY = 'onboarding_state';
const TOTAL_STEPS = 7;

// A/B: variant A = standard order, variant B = blockchain intro earlier (step 4).
// Step 1 is the analytics consent step, always right after Welcome (#1391).
export const STEP_SEQUENCES: Record<OnboardingVariant, number[]> = {
  A: [0, 1, 2, 3, 4, 5, 6],
  B: [0, 1, 2, 6, 3, 4, 5],
};

/**
 * Steps that cannot be skipped (#1393): pet setup (1) and notifications (2).
 * Welcome, biometric setup, first record and blockchain intro are optional.
 */
export const MANDATORY_STEPS: ReadonlySet<number> = new Set([1, 2]);

export function isStepSkippable(stepIndex: number): boolean {
  return !MANDATORY_STEPS.has(stepIndex);
}

export type StepStatus = 'completed' | 'skipped' | 'pending';

/** Status of each step in the variant's sequence, for progress indicators. */
export function getStepStatuses(state: OnboardingState): StepStatus[] {
  return STEP_SEQUENCES[state.variant].map((stepIndex) => {
    if (state.completedSteps.includes(stepIndex)) return 'completed';
    if (state.skippedSteps.includes(stepIndex)) return 'skipped';
    return 'pending';
  });
}

/**
 * Position in the step sequence to resume from: the first step that is
 * neither completed nor skipped. Lets onboarding resume after a crash.
 */
export function getResumePosition(state: OnboardingState): number {
  const sequence = STEP_SEQUENCES[state.variant];
  const position = sequence.findIndex(
    (stepIndex) =>
      !state.completedSteps.includes(stepIndex) && !state.skippedSteps.includes(stepIndex),
  );
  return position === -1 ? sequence.length - 1 : position;
}

function assignVariant(): OnboardingVariant {
  return Math.random() < 0.5 ? 'A' : 'B';
}

async function load(): Promise<OnboardingState | null> {
  try {
    const raw = await encryptedAsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OnboardingState) : null;
  } catch {
    return null;
  }
}

async function save(state: OnboardingState): Promise<void> {
  try {
    await encryptedAsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort
  }
}

async function init(): Promise<OnboardingState> {
  const existing = await load();
  if (existing) return existing;
  const state: OnboardingState = {
    currentStep: 0,
    completedSteps: [],
    skippedSteps: [],
    variant: assignVariant(),
    completed: false,
    startedAt: Date.now(),
  };
  await save(state);
  analyticsService.featureUsed('onboarding_start', { variant: state.variant });
  return state;
}

async function advanceStep(state: OnboardingState, stepIndex: number): Promise<OnboardingState> {
  const completed: OnboardingState = {
    ...state,
    completedSteps: [...new Set([...state.completedSteps, stepIndex])],
    skippedSteps: state.skippedSteps.filter((s) => s !== stepIndex),
  };
  // currentStep is a position in the sequence, persisted so resume works (#1393).
  const next: OnboardingState = { ...completed, currentStep: getResumePosition(completed) };
  await save(next);
  analyticsService.featureUsed('onboarding_step_complete', {
    step: stepIndex,
    variant: state.variant,
  });
  return next;
}

async function skipStep(state: OnboardingState, stepIndex: number): Promise<OnboardingState> {
  // Mandatory steps cannot be skipped (#1393).
  if (!isStepSkippable(stepIndex)) return state;
  const skipped: OnboardingState = {
    ...state,
    skippedSteps: [...new Set([...state.skippedSteps, stepIndex])],
  };
  const next: OnboardingState = { ...skipped, currentStep: getResumePosition(skipped) };
  await save(next);
  analyticsService.featureUsed('onboarding_step_skip', {
    step: stepIndex,
    variant: state.variant,
  });
  return next;
}

/**
 * "Skip all": skips optional steps from the current position up to the next
 * pending mandatory step. Returns whether onboarding can be completed now.
 */
async function skipToNextMandatory(
  state: OnboardingState,
): Promise<{ state: OnboardingState; canComplete: boolean }> {
  const sequence = STEP_SEQUENCES[state.variant];
  let next = state;
  for (let pos = getResumePosition(state); pos < sequence.length; pos += 1) {
    const stepIndex = sequence[pos];
    if (next.completedSteps.includes(stepIndex) || next.skippedSteps.includes(stepIndex)) {
      continue;
    }
    if (!isStepSkippable(stepIndex)) {
      return { state: next, canComplete: false };
    }
    next = await skipStep(next, stepIndex);
  }
  return { state: next, canComplete: true };
}

async function complete(state: OnboardingState): Promise<OnboardingState> {
  const next: OnboardingState = { ...state, completed: true };
  await save(next);
  const duration = Date.now() - state.startedAt;
  analyticsService.featureUsed('onboarding_complete', {
    variant: state.variant,
    completedSteps: next.completedSteps.length,
    skippedSteps: next.skippedSteps.length,
    durationMs: duration,
  });
  return next;
}

async function reset(): Promise<void> {
  await encryptedAsyncStorage.removeItem(STORAGE_KEY);
}

function completionPercentage(state: OnboardingState): number {
  const done = state.completedSteps.length + state.skippedSteps.length;
  return Math.round((done / TOTAL_STEPS) * 100);
}

async function saveLanguage(lang: LanguageCode): Promise<void> {
  const state = (await load()) ?? (await init());
  await save({ ...state, language: lang });
}

async function getSavedLanguage(): Promise<LanguageCode | null> {
  const state = await load();
  return state?.language ?? null;
}

const onboardingService = {
  init,
  load,
  save,
  advanceStep,
  skipStep,
  complete,
  reset,
  completionPercentage,
  skipToNextMandatory,
  getResumePosition,
  getStepStatuses,
  isStepSkippable,
  saveLanguage,
  getSavedLanguage,
  TOTAL_STEPS,
};
export default onboardingService;
