import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { usePetContext } from '../context/PetContext';
import { useRoutineStreakCalendar } from '../hooks/useRoutineStreakCalendar';
import { useScreenState } from '../hooks/useScreenState';
import { RoutineStreakCalendar } from '../components/RoutineStreakCalendar';
import { RetryError } from '../components/RetryError';
import { EmptyState } from '../components/EmptyState';
import { PermissionDenied } from '../components/PermissionDenied';
import { OfflineBanner } from '../components/OfflineBanner';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export const RoutineStreakScreen: React.FC = () => {
  const { t } = useTranslation();
  const { activePet } = usePetContext();

  const petId = activePet?.id;

  const {
    days,
    streakSummary,
    selectedDate,
    selectDate,
    isLoading,
    isOffline,
    isPermissionDenied,
    error,
    refetch,
  } = useRoutineStreakCalendar(petId);

  const screenState = useScreenState({
    isLoading,
    isOffline,
    isPermissionDenied,
    isError: Boolean(error),
    isEmpty: !petId || days.length === 0,
  });

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  const streakSummaryContent = useMemo(() => {
    if (!streakSummary) {
      return null;
    }
    return (
      <View
        style={styles.summaryCard}
        accessible
        accessibilityLabel={t('routineStreak.summary.accessibilityLabel', {
          current: streakSummary.currentStreak,
          longest: streakSummary.longestStreak,
        })}
      >
        <Text style={styles.summaryTitle} accessibilityRole="header">
          {t('routineStreak.summary.title')}
        </Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{streakSummary.currentStreak}</Text>
            <Text style={styles.summaryLabel}>
              {t('routineStreak.summary.currentStreak')}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{streakSummary.longestStreak}</Text>
            <Text style={styles.summaryLabel}>
              {t('routineStreak.summary.longestStreak')}
            </Text>
          </View>
        </View>
      </View>
    );
  }, [streakSummary, t]);

  if (screenState === 'permissionDenied') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading} accessibilityRole="header">
          {t('routineStreak.title')}
        </Text>
        <PermissionDenied
          message={t('routineStreak.permissionDenied')}
          testID="routine-streak-permission-denied"
        />
      </View>
    );
  }

  if (screenState === 'loading') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading} accessibilityRole="header">
          {t('routineStreak.title')}
        </Text>
        <View
          style={styles.centered}
          accessible
          accessibilityLabel={t('routineStreak.loading')}
        >
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('routineStreak.loading')}</Text>
        </View>
      </View>
    );
  }

  if (screenState === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading} accessibilityRole="header">
          {t('routineStreak.title')}
        </Text>
        <RetryError
          message={t('routineStreak.error')}
          retryLabel={t('common.retry')}
          onRetry={handleRetry}
          testID="routine-streak-retry"
        />
      </View>
    );
  }

  if (screenState === 'empty') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading} accessibilityRole="header">
          {t('routineStreak.title')}
        </Text>
        <EmptyState
          title={t('routineStreak.empty.title')}
          message={t('routineStreak.empty.message')}
          testID="routine-streak-empty"
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="routine-streak-screen"
    >
      <Text style={styles.heading} accessibilityRole="header">
        {t('routineStreak.title')}
      </Text>

      {screenState === 'offline' && (
        <OfflineBanner message={t('routineStreak.offline')} />
      )}

      {streakSummaryContent}

      <RoutineStreakCalendar
        days={days}
        selectedDate={selectedDate}
        onSelectDate={selectDate}
        testID="routine-streak-calendar"
      />

      <View style={styles.legend} accessible accessibilityLabel={t('routineStreak.legend.accessibilityLabel')}>
        <Text style={styles.legendTitle} accessibilityRole="header">
          {t('routineStreak.legend.title')}
        </Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, styles.legendDotCompleted]} />
          <Text style={styles.legendLabel}>{t('routineStreak.legend.completed')}</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, styles.legendDotSkipped]} />
          <Text style={styles.legendLabel}>{t('routineStreak.legend.skipped')}</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, styles.legendDotUnknown]} />
          <Text style={styles.legendLabel}>{t('routineStreak.legend.unknown')}</Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
  },
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    ...typography.heading,
    color: colors.primary,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  legend: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  legendTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacing.sm,
  },
  legendDotCompleted: {
    backgroundColor: colors.success,
  },
  legendDotSkipped: {
    backgroundColor: colors.warning,
  },
  legendDotUnknown: {
    backgroundColor: colors.border,
  },
  legendLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

export default RoutineStreakScreen;