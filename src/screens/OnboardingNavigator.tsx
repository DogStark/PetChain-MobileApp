import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

import MultiStepFormHeader from '../components/MultiStepFormHeader';
import { OnboardingProvider, useOnboarding } from '../context/OnboardingContext';
import { isStepSkippable } from '../services/onboardingService';
import AnalyticsConsentStep from './onboarding/AnalyticsConsentStep';
import BiometricStep from './onboarding/BiometricStep';
import BlockchainIntroStep from './onboarding/BlockchainIntroStep';
import FirstRecordStep from './onboarding/FirstRecordStep';
import NotificationsStep from './onboarding/NotificationsStep';
import PetSetupStep from './onboarding/PetSetupStep';
import WelcomeStep from './onboarding/WelcomeStep';

// Step index → component mapping (0-based, matches STEP_SEQUENCES values)
const STEP_COMPONENTS = [
  WelcomeStep,
  AnalyticsConsentStep,
  PetSetupStep,
  NotificationsStep,
  BiometricStep,
  FirstRecordStep,
  BlockchainIntroStep,
] as const;

interface OnboardingNavigatorProps {
  onComplete: () => void;
  onSkip: () => void;
}

function OnboardingFlow({ onComplete, onSkip }: OnboardingNavigatorProps) {
  const {
    state,
    loading,
    currentStep,
    totalSteps,
    stepSequence,
    stepStatuses,
    advance,
    skip,
    skipToNextMandatory,
    completeOnboarding,
  } = useOnboarding();
  const stepHeadingRef = useRef<View>(null);

  // Slide animation: translateX from right (+width) to 0
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  // Animate in on mount
  useEffect(() => {
    translateX.value = 60;
    opacity.value = 0;
    translateX.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
    opacity.value = withTiming(1, { duration: 280 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const animateOut = useCallback(
    (cb: () => void) => {
      translateX.value = withTiming(-60, { duration: 240, easing: Easing.in(Easing.cubic) });
      opacity.value = withTiming(0, { duration: 200 }, () => runOnJS(cb)());
    },
    [translateX, opacity],
  );

  const handleNext = useCallback(() => {
    const sequencePosition = currentStep; // position in the sequence
    const stepIndex = stepSequence[sequencePosition];
    const isLast = sequencePosition >= totalSteps - 1;

    animateOut(async () => {
      if (isLast) {
        await advance(stepIndex);
        await completeOnboarding();
        onComplete();
      } else {
        await advance(stepIndex);
      }
    });
  }, [currentStep, stepSequence, totalSteps, animateOut, advance, completeOnboarding, onComplete]);

  const handleSkip = useCallback(() => {
    const sequencePosition = currentStep;
    const stepIndex = stepSequence[sequencePosition];
    const isLast = sequencePosition >= totalSteps - 1;
    // Mandatory steps (pet setup, notifications) cannot be skipped (#1393).
    if (!isStepSkippable(stepIndex)) return;

    animateOut(async () => {
      if (isLast) {
        await skip(stepIndex);
        await completeOnboarding();
        onComplete();
      } else {
        await skip(stepIndex);
      }
    });
  }, [currentStep, stepSequence, totalSteps, animateOut, skip, completeOnboarding, onComplete]);

  // "Skip all" skips optional steps only, stopping at the next mandatory step.
  const handleGlobalSkip = useCallback(() => {
    animateOut(async () => {
      const canComplete = await skipToNextMandatory();
      if (canComplete) {
        await completeOnboarding();
        onSkip();
      }
    });
  }, [animateOut, skipToNextMandatory, completeOnboarding, onSkip]);

  if (loading || !state) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </SafeAreaView>
    );
  }

  const sequencePosition = Math.min(currentStep, totalSteps - 1);
  const stepIndex = stepSequence[sequencePosition];
  const StepComponent = STEP_COMPONENTS[stepIndex];
  const isLast = sequencePosition >= totalSteps - 1;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.stepLabel}>
          {sequencePosition + 1} / {totalSteps}
        </Text>
        <TouchableOpacity
          onPress={handleGlobalSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
        >
          <Text style={styles.skipAll}>Skip all</Text>
        </TouchableOpacity>
      </View>

      {/* Progress: completed vs skipped steps (#1393) */}
      <View style={styles.progressHeader}>
        <MultiStepFormHeader
          stepHeadingRef={stepHeadingRef}
          announcement={`Step ${sequencePosition + 1} of ${totalSteps}`}
          currentStep={sequencePosition}
          totalSteps={totalSteps}
          stepStatuses={stepStatuses}
        />
      </View>

      {/* Animated step */}
      <Animated.View style={[styles.stepContainer, animatedStyle]}>
        <StepComponent
          onNext={handleNext}
          onSkip={handleSkip}
          canSkip={isStepSkippable(stepIndex)}
          {...(isLast && stepIndex === 6 ? { isLast: true } : {})}
        />
      </Animated.View>
    </SafeAreaView>
  );
}

export default function OnboardingNavigator(props: OnboardingNavigatorProps) {
  return (
    <OnboardingProvider>
      <OnboardingFlow {...props} />
    </OnboardingProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  stepLabel: { fontSize: 13, color: '#9CA3AF', fontWeight: '500' },
  skipAll: { fontSize: 14, color: '#6B7280' },
  progressTrack: {
    height: 4,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 20,
    borderRadius: 2,
    marginBottom: 4,
  },
  progressFill: { height: 4, backgroundColor: '#3B82F6', borderRadius: 2 },
  progressHeader: { marginHorizontal: 20 },
  stepContainer: { flex: 1 },
});
