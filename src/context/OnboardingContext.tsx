import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { changeLanguage } from '../i18n';
import onboardingService, {
  type OnboardingState,
  type OnboardingVariant,
  STEP_SEQUENCES,
} from '../services/onboardingService';

interface OnboardingContextValue {
  state: OnboardingState | null;
  loading: boolean;
  currentStep: number;
  totalSteps: number;
  completionPercentage: number;
  variant: OnboardingVariant;
  /** Ordered step indices for the current variant */
  stepSequence: number[];
  advance: (stepIndex: number) => Promise<void>;
  skip: (stepIndex: number) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  reset: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onboardingService.init().then(async (s) => {
      if (s.language) {
        await changeLanguage(s.language);
      }
      setState(s);
      setLoading(false);
    });
  }, []);

  const advance = useCallback(
    async (stepIndex: number) => {
      if (!state) return;
      const next = await onboardingService.advanceStep(state, stepIndex);
      setState(next);
    },
    [state],
  );

  const skip = useCallback(
    async (stepIndex: number) => {
      if (!state) return;
      const next = await onboardingService.skipStep(state, stepIndex);
      setState(next);
    },
    [state],
  );

  const completeOnboarding = useCallback(async () => {
    if (!state) return;
    const next = await onboardingService.complete(state);
    setState(next);
  }, [state]);

  const reset = useCallback(async () => {
    await onboardingService.reset();
    const fresh = await onboardingService.init();
    setState(fresh);
  }, []);

  const value = useMemo<OnboardingContextValue>(() => {
    const variant: OnboardingVariant = state?.variant ?? 'A';
    const stepSequence = STEP_SEQUENCES[variant];
    return {
      state,
      loading,
      currentStep: state?.currentStep ?? 0,
      totalSteps: onboardingService.TOTAL_STEPS,
      completionPercentage: state ? onboardingService.completionPercentage(state) : 0,
      variant,
      stepSequence,
      advance,
      skip,
      completeOnboarding,
      reset,
    };
  }, [state, loading, advance, skip, completeOnboarding, reset]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used within OnboardingProvider');
  return value;
}
