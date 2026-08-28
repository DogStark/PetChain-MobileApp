import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import type { VerificationStatus } from '../services/verificationService';

interface Props {
  status: VerificationStatus;
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  VerificationStatus,
  { icon: string; label: string; bg: string; color: string }
> = {
  verified: { icon: '✓', label: 'Blockchain Verified', bg: '#10B981', color: '#fff' },
  tampered: { icon: '✕', label: 'Tampered', bg: '#EF4444', color: '#fff' },
  unverified: { icon: '—', label: 'Not on Chain', bg: '#6B7280', color: '#fff' },
  pending: { icon: '⏳', label: 'Verifying…', bg: '#F59E0B', color: '#fff' },
  offline: { icon: '⚡', label: 'Cached (Offline)', bg: '#8B5CF6', color: '#fff' },
};

export const TrustBadge: React.FC<Props> = ({ status, compact = false }) => {
  const { icon, label, bg, color } = STATUS_CONFIG[status] ?? STATUS_CONFIG.unverified;

  return (
    <View
      style={[styles.badge, { backgroundColor: bg }, compact && styles.compact]}
      accessibilityRole="text"
      accessibilityLabel={`Verification status: ${label}`}
    >
      <Text style={[styles.icon, { color }]}>{icon}</Text>
      {!compact && <Text style={[styles.label, { color }]}>{label}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    alignSelf: 'flex-start',
  },
  compact: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  icon: {
    fontSize: 13,
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
