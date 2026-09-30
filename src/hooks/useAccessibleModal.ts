/**
 * useAccessibleModal.ts
 *
 * Shared focus / back-button / dismissal behaviour for every dialog in the app.
 *
 * Before this, each modal wired up `AccessibilityInfo.setAccessibilityFocus`,
 * the Android hardware back button, and backdrop dismissal on its own (or not at
 * all). This hook standardises:
 *  - move screen-reader focus to the dialog title when it opens
 *  - restore focus to the trigger element when it closes (focus restore)
 *  - Android hardware back closes the top-most open dialog only
 *  - nested modals: only the last-opened dialog handles back / receives focus
 *
 * The stacking logic lives in the pure `modalStack` helpers so it can be unit
 * tested without a renderer.
 */

import { useEffect, useId, useRef } from 'react';
import { AccessibilityInfo, BackHandler, findNodeHandle, type View } from 'react-native';

const stack: string[] = [];

export const modalStack = {
  push(id: string): void {
    if (!stack.includes(id)) stack.push(id);
  },
  remove(id: string): void {
    const i = stack.indexOf(id);
    if (i !== -1) stack.splice(i, 1);
  },
  /** id of the dialog that should own focus / the back button */
  top(): string | undefined {
    return stack[stack.length - 1];
  },
  isTop(id: string): boolean {
    return stack.length > 0 && stack[stack.length - 1] === id;
  },
  depth(): number {
    return stack.length;
  },
  _reset(): void {
    stack.length = 0;
  },
};

export interface UseAccessibleModalOptions {
  visible: boolean;
  onClose: () => void;
  /** Announced / focused when the dialog opens */
  titleRef?: React.RefObject<View | null>;
  /** Element focus returns to on close (usually the button that opened it) */
  returnFocusRef?: React.RefObject<View | null>;
  /** Text spoken when the dialog opens; defaults to nothing extra */
  announcement?: string;
}

export interface AccessibleModalProps {
  visible: boolean;
  transparent: true;
  /** RN calls this for Android back AND accessibility escape */
  onRequestClose: () => void;
  accessibilityViewIsModal: true;
  accessibilityRole: 'none';
  onDismiss: () => void;
}

function focus(ref?: React.RefObject<View | null>): void {
  const node = ref?.current ? findNodeHandle(ref.current) : null;
  if (node) AccessibilityInfo.setAccessibilityFocus(node);
}

export function useAccessibleModal({
  visible,
  onClose,
  titleRef,
  returnFocusRef,
  announcement,
}: UseAccessibleModalOptions): AccessibleModalProps {
  const id = useId();
  const wasVisible = useRef(false);

  // Register / unregister in the shared stack and drive focus.
  useEffect(() => {
    if (visible && !wasVisible.current) {
      wasVisible.current = true;
      modalStack.push(id);
      const t = setTimeout(() => {
        if (modalStack.isTop(id)) {
          focus(titleRef);
          if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
        }
      }, 100);
      return () => clearTimeout(t);
    }

    if (!visible && wasVisible.current) {
      wasVisible.current = false;
      modalStack.remove(id);
      const t = setTimeout(() => focus(returnFocusRef), 50);
      return () => clearTimeout(t);
    }

    return undefined;
  }, [visible, id, titleRef, returnFocusRef, announcement]);

  // Ensure we leave the stack if unmounted while open.
  useEffect(() => () => modalStack.remove(id), [id]);

  // Android hardware back — only the top-most dialog reacts.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (modalStack.isTop(id)) {
        onClose();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [visible, id, onClose]);

  const handleClose = () => {
    if (modalStack.isTop(id) || modalStack.depth() === 0) onClose();
  };

  return {
    visible,
    transparent: true,
    onRequestClose: handleClose,
    accessibilityViewIsModal: true,
    accessibilityRole: 'none',
    onDismiss: handleClose,
  };
}
