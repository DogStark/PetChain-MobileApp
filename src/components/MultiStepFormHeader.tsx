import React from 'react';
import { StyleSheet, Text, View, type View as ViewType } from 'react-native';

export type StepProgressStatus = 'completed' | 'skipped' | 'pending';

interface Props {
  stepHeadingRef: React.RefObject<ViewType | null>;
  announcement: string;
  currentStep: number;
  totalSteps: number;
  /**
   * Optional per-step status. When provided, completed and skipped steps are
   * drawn differently so progress reflects what was actually done (#1393).
   */
  stepStatuses?: StepProgressStatus[];
}

function progressLabel(statuses: StepProgressStatus[] | undefined, total: number): string | undefined {
  if (!statuses) return undefined;
  const completed = statuses.filter((s) => s === 'completed').length;
  const skipped = statuses.filter((s) => s === 'skipped').length;
  return `${completed} of ${total} steps completed, ${skipped} skipped`;
}

const MultiStepFormHeader: React.FC<Props> = ({
  stepHeadingRef,
  announcement,
  currentStep,
  totalSteps,
  stepStatuses,
}) => (
  <View style={styles.container}>
    <Text
      ref={stepHeadingRef}
      style={styles.heading}
      accessibilityRole="header"
      accessibilityLabel={announcement}
    >
      {announcement}
    </Text>
    <View
      style={styles.progressRow}
      accessibilityRole="progressbar"
      accessibilityLabel={progressLabel(stepStatuses, totalSteps)}
    >
      {Array.from({ length: totalSteps }, (_, index) => {
        const status = stepStatuses?.[index];
        return (
          <View
            key={index}
            style={[
              styles.progressDot,
              status
                ? [
                    status === 'completed' && styles.progressDotActive,
                    status === 'skipped' && styles.progressDotSkipped,
                    status === 'pending' && index === currentStep && styles.progressDotCurrent,
                  ]
                : index <= currentStep && styles.progressDotActive,
            ]}
            accessible={false}
          />
        );
      })}
    </View>
  </View>
);

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
  progressDotSkipped: { backgroundColor: '#F59E0B' },
  progressDotCurrent: { backgroundColor: '#93C5FD' },
});

export default MultiStepFormHeader;
