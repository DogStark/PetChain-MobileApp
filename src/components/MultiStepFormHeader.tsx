import React from 'react';
import { StyleSheet, Text, View, type View as ViewType } from 'react-native';

interface Props {
  stepHeadingRef?: React.RefObject<ViewType | null>;
  announcement: string;
  currentStep: number;
  totalSteps: number;
  completedSteps?: number[];
  skippedSteps?: number[];
}

const MultiStepFormHeader: React.FC<Props> = ({
  stepHeadingRef,
  announcement,
  currentStep,
  totalSteps,
  completedSteps,
  skippedSteps,
}) => {
  const hasExplicitStatus = completedSteps !== undefined || skippedSteps !== undefined;

  return (
    <View style={styles.container}>
      <Text
        ref={stepHeadingRef}
        style={styles.heading}
        accessibilityRole="header"
        accessibilityLabel={announcement}
      >
        {announcement}
      </Text>
      <View style={styles.progressRow} accessibilityRole="progressbar">
        {Array.from({ length: totalSteps }, (_, index) => {
          const isCompleted = completedSteps?.includes(index) ?? false;
          const isSkipped = !isCompleted && (skippedSteps?.includes(index) ?? false);
          const isCurrent = !isCompleted && !isSkipped && index === currentStep;
          const legacyActive = !hasExplicitStatus && index <= currentStep;
          const statusLabel = hasExplicitStatus
            ? isCompleted
              ? 'completed'
              : isSkipped
                ? 'skipped'
                : isCurrent
                  ? 'current'
                  : 'upcoming'
            : legacyActive
              ? 'active'
              : 'upcoming';

          return (
            <View
              key={index}
              testID={`progress-dot-${index}`}
              accessibilityLabel={`Step ${index + 1}: ${statusLabel}`}
              style={[
                styles.progressDot,
                legacyActive && styles.progressDotActive,
                hasExplicitStatus &&
                  isCompleted && [styles.progressDotActive, styles.progressDotCompleted],
                hasExplicitStatus && isSkipped && styles.progressDotSkipped,
                hasExplicitStatus && isCurrent && styles.progressDotCurrent,
              ]}
              accessible={false}
            />
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  heading: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  progressRow: { flexDirection: 'row', gap: 6 },
  progressDot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e0e0e0',
  },
  progressDotActive: { backgroundColor: '#4CAF50' },
  progressDotCompleted: { backgroundColor: '#4CAF50' },
  progressDotSkipped: { backgroundColor: '#F59E0B', opacity: 0.7 },
  progressDotCurrent: { backgroundColor: '#3B82F6' },
});

export default MultiStepFormHeader;
