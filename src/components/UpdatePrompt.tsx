import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  BackHandler,
  Platform,
} from 'react-native';

import { useAppTheme } from '../theme';

interface Props {
  /** 'optional' shows a dismiss button; 'force' hides it */
  variant: 'optional' | 'force';
  /** Called when the user taps "Update Now" (OTA) */
  onUpdate?: () => void;
  /** Store URL for native force-update */
  storeUrl?: string;
  /** Called when the user dismisses an optional prompt */
  onDismiss?: () => void;
  visible: boolean;
}

export default function UpdatePrompt({ variant, onUpdate, storeUrl, onDismiss, visible }: Props) {
  const colors = useAppTheme();
  const isForce = variant === 'force';

  // Prevent Android back-button from dismissing a force-update modal
  React.useEffect(() => {
    if (!isForce || !visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [isForce, visible]);

  const handlePrimary = () => {
    if (storeUrl) {
      void Linking.openURL(storeUrl);
    } else {
      onUpdate?.();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={isForce ? undefined : onDismiss}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View
          style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.shadow }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            {isForce ? 'Update Required' : 'Update Available'}
          </Text>
          <Text style={[styles.body, { color: colors.secondaryText }]}>
            {isForce
              ? 'A critical update is required to continue using PetChain. Please update the app from the store.'
              : 'A new version of PetChain is ready. Update now for the latest features and fixes.'}
          </Text>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.info }]}
            onPress={handlePrimary}
            accessibilityRole="button"
            accessibilityLabel="Update now"
          >
            <Text style={styles.primaryText}>Update Now</Text>
          </TouchableOpacity>

          {!isForce && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Remind me later"
            >
              <Text style={[styles.secondaryText, { color: colors.info }]}>Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

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
    maxWidth: 360,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 8 },
    }),
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { paddingVertical: 8 },
  secondaryText: { fontSize: 14 },
});
