import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, type TextInput, type View } from 'react-native';

export interface MultiStepDefinition {
  title: string;
}

export type StepDirection = 'forward' | 'back' | 'error';

export function formatStepAnnouncement(step: number, total: number, title: string): string {
  return `Step ${step + 1} of ${total}: ${title}`;
}

type FocusableRef = View | TextInput | null;

export function useMultiStepFormFocus(steps: MultiStepDefinition[]) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState<StepDirection>('forward');
  const stepHeadingRef = useRef<View>(null);
  const firstInteractiveRefs = useRef<FocusableRef[]>([]);
  const fieldRefs = useRef<Record<string, TextInput | null>>({});
  const pendingErrorFieldRef = useRef<string | null>(null);

  const totalSteps = steps.length;

  const registerFirstInteractive = useCallback((stepIndex: number, ref: FocusableRef) => {
    firstInteractiveRefs.current[stepIndex] = ref;
  }, []);

  const registerFieldRef = useCallback((fieldKey: string, ref: TextInput | null) => {
    fieldRefs.current[fieldKey] = ref;
  }, []);

  const goToStep = useCallback(
    (step: number, dir: StepDirection = 'forward') => {
      setDirection(dir);
      setCurrentStep(Math.max(0, Math.min(step, totalSteps - 1)));
    },
    [totalSteps],
  );

  const goNext = useCallback(() => {
    goToStep(currentStep + 1, 'forward');
  }, [currentStep, goToStep]);

  const goBack = useCallback(() => {
    goToStep(currentStep - 1, 'back');
  }, [currentStep, goToStep]);

  const resetSteps = useCallback(() => {
    setCurrentStep(0);
    setDirection('forward');
    pendingErrorFieldRef.current = null;
  }, []);

  const focusFirstError = useCallback(
    (fieldKey: string, message?: string, stepIndex?: number) => {
      pendingErrorFieldRef.current = fieldKey;
      setDirection('error');
      if (stepIndex !== undefined) {
        setCurrentStep(Math.max(0, Math.min(stepIndex, totalSteps - 1)));
      }
      if (message) {
        AccessibilityInfo.announceForAccessibility(message);
      }
    },
    [totalSteps],
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (direction === 'error' && pendingErrorFieldRef.current) {
        const fieldRef = fieldRefs.current[pendingErrorFieldRef.current];
        const node = fieldRef ? findNodeHandle(fieldRef) : null;
        if (node) {
          AccessibilityInfo.setAccessibilityFocus(node);
        }
        pendingErrorFieldRef.current = null;
        return;
      }

      if (direction === 'back') {
        const ref = firstInteractiveRefs.current[currentStep];
        const node = ref ? findNodeHandle(ref) : null;
        if (node) {
          AccessibilityInfo.setAccessibilityFocus(node);
        }
        return;
      }

      const headingNode = findNodeHandle(stepHeadingRef.current);
      if (headingNode) {
        AccessibilityInfo.setAccessibilityFocus(headingNode);
      }
      const step = steps[currentStep];
      if (step) {
        AccessibilityInfo.announceForAccessibility(
          formatStepAnnouncement(currentStep, totalSteps, step.title),
        );
      }
    }, 100);

    return () => clearTimeout(timeout);
  }, [currentStep, direction, steps, totalSteps]);

  const stepTitle = steps[currentStep]?.title ?? '';
  const stepAnnouncement = formatStepAnnouncement(currentStep, totalSteps, stepTitle);

  return {
    currentStep,
    totalSteps,
    stepHeadingRef,
    stepTitle,
    stepAnnouncement,
    registerFirstInteractive,
    registerFieldRef,
    goNext,
    goBack,
    goToStep,
    resetSteps,
    focusFirstError,
    isFirstStep: currentStep === 0,
    isLastStep: currentStep === totalSteps - 1,
  };
}
