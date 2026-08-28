import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export type VerificationStatus = 'pending' | 'verified' | 'failed' | 'unknown';

interface Props {
  status?: VerificationStatus;
  onVerifyPress?: () => void;
  showButton?: boolean;
}

/**
 * Visual badge indicating blockchain verification status for a medical record.
 *
 * - Verified: Green checkmark (✓)
 * - Failed: Red X
 * - Pending: Yellow clock/hourglass
 * - Unknown/Not verified: Gray dash or question mark
 *
 * Optionally includes a "Verify" button to trigger on-chain verification.
 */
export const VerificationBadge: React.FC<Props> = ({
  status = 'unknown',
  onVerifyPress,
  showButton = false,
}) => {
  const config: Record<
    VerificationStatus,
    { icon: string; color: string; bg: string; label: string }
  > = {
    verified: { icon: '✓', color: '#fff', bg: '#10B981', label: 'Verified' },
    failed: { icon: '✕', color: '#fff', bg: '#EF4444', label: 'Verification Failed' },
    pending: { icon: '⏳', color: '#fff', bg: '#F59E0B', label: 'Pending' },
    unknown: { icon: '—', color: '#9CA3AF', bg: '#F3F4F6', label: 'Not Verified' },
  };

  const { icon, color, bg, label } = config[status];

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: bg }]} accessibilityLabel={label}>
        <Text style={[styles.icon, { color }]}>{icon}</Text>
      </View>
      {showButton && status !== 'verified' && (
        <TouchableOpacity
          style={styles.verifyBtn}
          onPress={onVerifyPress}
          accessibilityRole="button"
        >
          <Text style={styles.verifyBtnText}>Verify on Chain</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 14,
    fontWeight: '700',
  },
  verifyBtn: {
    backgroundColor: '#4A90A4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  verifyBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
