import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface VetVerifiedBadgeProps {
  federatedAddress: string;
  verified: boolean;
  compact?: boolean;
}

export const VetVerifiedBadge: React.FC<VetVerifiedBadgeProps> = ({
  federatedAddress,
  verified,
  compact = false,
}) => {
  if (!verified) return null;

  return (
    <View style={[styles.container, compact && styles.compact]}>
      <Text style={styles.icon}>✓</Text>
      {!compact && (
        <Text style={styles.label} numberOfLines={1}>
          {federatedAddress}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e6f4ea',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    gap: 4,
  },
  compact: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  icon: {
    color: '#1a7f37',
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    color: '#1a7f37',
    fontSize: 12,
    fontWeight: '500',
    maxWidth: 200,
  },
});
