import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface RetryErrorProps {
  error: Error;
  onRetry: () => void;
  retryCount?: number;
  maxRetries?: number;
}

export const RetryError: React.FC<RetryErrorProps> = ({
  error,
  onRetry,
  retryCount = 0,
  maxRetries = 3,
}) => {
  const canRetry = retryCount < maxRetries;

  return (
    <View style={styles.container}>
      <Text style={styles.errorIcon}>⚠️</Text>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
      {retryCount > 0 && (
        <Text style={styles.retryInfo}>
          Attempt {retryCount} of {maxRetries}
        </Text>
      )}
      {canRetry && (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry request"
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      )}
      {!canRetry && <Text style={styles.maxRetriesText}>Maximum retry attempts reached</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#d32f2f',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryInfo: {
    fontSize: 12,
    color: '#999',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  maxRetriesText: {
    fontSize: 12,
    color: '#d32f2f',
    fontStyle: 'italic',
  },
});
