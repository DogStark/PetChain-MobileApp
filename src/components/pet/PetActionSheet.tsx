import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PetRecord } from '../../types/pet';

type PetActionSheetProps = {
  visible: boolean;
  petName: string;
  record?: PetRecord | null;
  onClose: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
};

type ActionItem = {
  key: string;
  label: string;
  hint: string;
  destructive?: boolean;
  onPress: () => void;
};

/**
 * Action sheet for a pet profile record.
 *
 * Accessibility notes (#1059):
 * - Actions are exposed in a stable, logical order: edit -> share -> delete.
 * - Each icon-only action carries an explicit accessibilityLabel and
 *   accessibilityHint so VoiceOver/TalkBack announce intent, not glyphs.
 * - The sheet announces itself once when it opens and moves focus to the
 *   first action so screen-reader users land in a predictable place.
 * - Decorative separators are hidden from the accessibility tree.
 */
export function PetActionSheet({
  visible,
  petName,
  record,
  onClose,
  onEdit,
  onShare,
  onDelete,
}: PetActionSheetProps) {
  const firstActionRef = useRef<View>(null);
  const hasAnnouncedRef = useRef(false);

  const actions = useMemo<ActionItem[]>(() => {
    const recordLabel = record?.title ? ` for ${record.title}` : '';
    return [
      {
        key: 'edit',
        label: `Edit record${recordLabel}`,
        hint: `Opens the editor for this record on ${petName}'s profile`,
        onPress: onEdit,
      },
      {
        key: 'share',
        label: `Share record${recordLabel}`,
        hint: `Opens the share options for this record on ${petName}'s profile`,
        onPress: onShare,
      },
      {
        key: 'delete',
        label: `Delete record${recordLabel}`,
        hint: `Removes this record from ${petName}'s profile. This cannot be undone.`,
        destructive: true,
        onPress: onDelete,
      },
    ];
  }, [onDelete, onEdit, onShare, petName, record?.title]);

  // Announce the sheet once when it becomes visible and move focus to the
  // first action so traversal starts at a known point.
  useEffect(() => {
    if (!visible) {
      hasAnnouncedRef.current = false;
      return;
    }
    if (hasAnnouncedRef.current) {
      return;
    }
    hasAnnouncedRef.current = true;

    const announcement = record?.title
      ? `Record actions for ${record.title} on ${petName}'s profile`
      : `Record actions for ${petName}'s profile`;
    AccessibilityInfo.announceForAccessibility(announcement);

    const node = findNodeHandle(firstActionRef.current);
    if (node != null) {
      AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [petName, record?.title, visible]);

  const handleActionPress = useCallback(
    (action: ActionItem) => {
      if (action.destructive) {
        Alert.alert(
          action.label,
          action.hint,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                action.onPress();
                onClose();
              },
            },
          ],
          { cancelable: true },
        );
        return;
      }
      action.onPress();
      onClose();
    },
    [onClose],
  );

  // On iOS we can defer to the native action sheet, which already provides
  // accessible labels and focus handling.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !visible) {
      return;
    }
    const options = actions.map((action) => action.label);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: record?.title ? `Record: ${record.title}` : undefined,
        options: [...options, 'Cancel'],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: actions.findIndex((action) => action.destructive),
      },
      (buttonIndex) => {
        const action = actions[buttonIndex];
        if (action) {
          handleActionPress(action);
        } else {
          onClose();
        }
      },
    );
  }, [actions, handleActionPress, onClose, record?.title, visible]);

  if (!visible || Platform.OS === 'ios') {
    return null;
  }

  return (
    <View
      style={styles.backdrop}
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
    >
      <View
        style={styles.sheet}
        accessible={false}
        accessibilityLabel={`Record actions for ${petName}'s profile`}
      >
        <Text style={styles.title} accessibilityRole="header">
          {record?.title ? `Record: ${record.title}` : 'Record actions'}
        </Text>

        {/* Decorative separator: hidden from the accessibility tree. */}
        <View
          style={styles.separator}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />

        {actions.map((action, index) => (
          <Pressable
            key={action.key}
            ref={index === 0 ? firstActionRef : undefined}
            style={styles.action}
            onPress={() => handleActionPress(action)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityHint={action.hint}
          >
            <Text
              style={[styles.actionText, action.destructive && styles.destructiveText]}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}

        <Pressable
          style={styles.action}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          accessibilityHint="Closes the record actions without making changes"
        >
          <Text style={styles.actionText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e0e0e0',
  },
  action: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  actionText: {
    fontSize: 16,
    color: '#111',
  },
  destructiveText: {
    color: '#d32f2f',
  },
});

export default PetActionSheet;
