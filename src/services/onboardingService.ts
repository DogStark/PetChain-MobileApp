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
const TOTAL_STEPS = 6;

// Mandatory onboarding steps (1 = PetSetupStep, 2 = NotificationsStep) cannot be skipped
export const MANDATORY_STEPS: readonly number[] = [1, 2];

export function isMandatoryStep(stepIndex: number): boolean {
  return MANDATORY_STEPS.includes(stepIndex);
}

// A/B: variant A = standard order, variant B = blockchain intro earlier (step 3)
export const STEP_SEQUENCES: Record<OnboardingVariant, number[]> = {
  A: [0, 1, 2, 3, 4, 5],
  B: [0, 1, 5, 2, 3, 4],
};

export function resolveResumeStep(state: OnboardingState): number {
  if (state.completedSteps.length === 0 && state.skippedSteps.length === 0) {
    return state.currentStep;
  }
  const sequence = STEP_SEQUENCES[state.variant ?? 'A'] ?? STEP_SEQUENCES.A;
  const visited = new Set([...state.completedSteps, ...state.skippedSteps]);
  const nextPos = sequence.findIndex((step) => !visited.has(step));
  return nextPos === -1 ? TOTAL_STEPS : nextPos;
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
  if (existing) {
    if (
      !existing.completed &&
      (existing.completedSteps.length > 0 || existing.skippedSteps.length > 0)
    ) {
      const resumedStep = resolveResumeStep(existing);
      if (resumedStep !== existing.currentStep) {
        const updated: OnboardingState = { ...existing, currentStep: resumedStep };
        await save(updated);
        return updated;
      }
    }
    return existing;
  }
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
  const completedSteps = [...new Set([...state.completedSteps, stepIndex])];
  const skippedSteps = state.skippedSteps.filter((s) => s !== stepIndex);
  const sequence = STEP_SEQUENCES[state.variant ?? 'A'] ?? STEP_SEQUENCES.A;
  const seqPos = sequence.indexOf(stepIndex);
  const nextCurrentStep = Math.max(
    seqPos >= 0 ? seqPos + 1 : stepIndex + 1,
    resolveResumeStep({ ...state, completedSteps, skippedSteps }),
  );
  const next: OnboardingState = {
    ...state,
    completedSteps,
    skippedSteps,
    currentStep: nextCurrentStep,
  };
  await save(next);
  analyticsService.featureUsed('onboarding_step_complete', {
    step: stepIndex,
    variant: state.variant,
  });
  return next;
}

async function skipStep(state: OnboardingState, stepIndex: number): Promise<OnboardingState> {
  if (isMandatoryStep(stepIndex)) {
    throw new Error(`Step ${stepIndex} is mandatory and cannot be skipped`);
  }
  const skippedSteps = [...new Set([...state.skippedSteps, stepIndex])];
  const sequence = STEP_SEQUENCES[state.variant ?? 'A'] ?? STEP_SEQUENCES.A;
  const seqPos = sequence.indexOf(stepIndex);
  const nextCurrentStep = Math.max(
    seqPos >= 0 ? seqPos + 1 : stepIndex + 1,
    resolveResumeStep({ ...state, skippedSteps }),
  );
  const next: OnboardingState = {
    ...state,
    skippedSteps,
    currentStep: nextCurrentStep,
  };
  await save(next);
  analyticsService.featureUsed('onboarding_step_skip', {
    step: stepIndex,
    variant: state.variant,
  });
  return next;
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
  saveLanguage,
  getSavedLanguage,
  isMandatoryStep,
  resolveResumeStep,
  MANDATORY_STEPS,
  TOTAL_STEPS,
};
export default onboardingService;
