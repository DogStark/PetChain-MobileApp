/**
 * AccessibleModal.tsx
 *
 * The single accessible dialog primitive for the app (issue #980).
 *
 * Wraps React Native's `Modal` with:
 *  - screen-reader focus moved to the dialog title on open, restored to the
 *    trigger on close (pass `returnFocusRef`)
 *  - consistent Android hardware-back + accessibility-escape handling
 *  - nested-modal safety: only the top-most instance reacts to back / focus
 *  - a labelled, `accessibilityViewIsModal` container and a header-role title
 *
 * Migrate existing dialogs (ReminderSnoozeModal, PaywallModal, SessionTimeoutModal,
 * ConflictResolutionModal, PermissionRationaleModal, …) onto this component so
 * behaviour stops diverging per screen.
 */

import React, { useRef } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../theme';
import { useAccessibleModal } from '../hooks/useAccessibleModal';
import { useReducedMotion } from '../utils/motion';

export interface AccessibleModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Focus returns here on close — usually the button that opened the dialog. */
  returnFocusRef?: React.RefObject<View | null>;
  /** Tapping the dimmed backdrop closes the dialog. Default: true. */
  dismissOnBackdropPress?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Overrides the spoken announcement (defaults to `${title} dialog`). */
  announcement?: string;
  testID?: string;
}

export default function AccessibleModal({
  visible,
  onClose,
  title,
  children,
  returnFocusRef,
  dismissOnBackdropPress = true,
  contentStyle,
  announcement,
  testID,
}: AccessibleModalProps) {
  const colors = useAppTheme();
  const reduceMotion = useReducedMotion();
  const titleRef = useRef<View>(null);

  const modalProps = useAccessibleModal({
    visible,
    onClose,
    titleRef,
    returnFocusRef,
    announcement: announcement ?? `${title} dialog`,
  });

  return (
    <Modal
      {...modalProps}
      animationType={reduceMotion ? 'none' : 'fade'}
      testID={testID}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        accessible={false}
        onPress={dismissOnBackdropPress ? onClose : undefined}
      >
        <Pressable
          style={[styles.card, { backgroundColor: colors.surface }, contentStyle]}
          accessibilityViewIsModal
          // stop backdrop press from bubbling when tapping the card itself
          onPress={() => {}}
        >
          <Text
            ref={titleRef as never}
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {title}
          </Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { borderRadius: 16, padding: 24 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
});
