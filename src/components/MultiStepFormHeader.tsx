import React from 'react';
import { StyleSheet, Text, View, type View as ViewType } from 'react-native';

interface Props {
  stepHeadingRef: React.RefObject<ViewType | null>;
  announcement: string;
  currentStep: number;
  totalSteps: number;
}

const MultiStepFormHeader: React.FC<Props> = ({
  stepHeadingRef,
  announcement,
  currentStep,
  totalSteps,
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
    <View style={styles.progressRow} accessibilityRole="progressbar">
      {Array.from({ length: totalSteps }, (_, index) => (
        <View
          key={index}
          style={[styles.progressDot, index <= currentStep && styles.progressDotActive]}
          accessible={false}
        />
      ))}
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
});

export default MultiStepFormHeader;
