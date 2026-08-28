import React from 'react';
import { Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppTheme } from '../theme';
import { type PermissionType, PERMISSION_RATIONALES } from '../utils/permissionRationale';

interface Props {
  visible: boolean;
  permissionType: PermissionType;
  /** Called when user taps "Allow" — caller should request the permission */
  onAllow: () => void;
  /** Called when user taps "Not Now" */
  onDeny: () => void;
  /** When true, shows a "Open Settings" button instead of "Allow" */
  showSettings?: boolean;
}

const PermissionRationaleModal: React.FC<Props> = ({
  visible,
  permissionType,
  onAllow,
  onDeny,
  showSettings = false,
}) => {
  const colors = useAppTheme();
  const rationale = PERMISSION_RATIONALES[permissionType];

  const handlePrimaryAction = () => {
    if (showSettings) {
      void Linking.openSettings();
    } else {
      onAllow();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDeny}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={styles.icon}>{rationale.icon}</Text>
          <Text style={[styles.title, { color: colors.text }]}>{rationale.title}</Text>
          <Text style={[styles.description, { color: colors.secondaryText }]}>
            {rationale.description}
          </Text>

          <View style={styles.benefitsContainer}>
            {rationale.benefits.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <Text style={[styles.checkmark, { color: colors.success }]}>✓</Text>
                <Text style={[styles.benefitText, { color: colors.secondaryText }]}>{benefit}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.success }]}
            onPress={handlePrimaryAction}
            accessibilityRole="button"
            accessibilityLabel={showSettings ? 'Open Settings' : 'Allow'}
          >
            <Text style={styles.primaryButtonText}>{showSettings ? 'Open Settings' : 'Allow'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onDeny}
            accessibilityRole="button"
            accessibilityLabel="Not Now"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.secondaryText }]}>
              Not Now
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  icon: { fontSize: 48, marginBottom: 12 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  benefitsContainer: { alignSelf: 'stretch', marginBottom: 24 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  checkmark: { fontWeight: '700', marginRight: 8, fontSize: 14 },
  benefitText: { flex: 1, fontSize: 14, lineHeight: 20 },
  primaryButton: {
    borderRadius: 10,
    paddingVertical: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    paddingVertical: 10,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 14 },
});

export default PermissionRationaleModal;
