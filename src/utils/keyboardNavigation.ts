/**
 * keyboardNavigation.ts
 *
 * Utilities for complete keyboard navigation support in PetChain MobileApp.
 * Provides focus indicators, tab order management, keyboard shortcuts,
 * accessibility props, and focus trap helpers for external keyboard users.
 */

// ---------------------------------------------------------------------------
// Focus indicator styles
// ---------------------------------------------------------------------------

/** Style object applied to a component when it has keyboard focus. */
export const FOCUS_INDICATOR_STYLE = {
  borderWidth: 2,
  borderColor: '#4CAF50',
  borderRadius: 8,
  shadowColor: '#4CAF50',
  shadowOpacity: 0.4,
  shadowRadius: 4,
  elevation: 3,
} as const;

/**
 * Merges focus indicator styles into a base style when the element is focused.
 * Does not mutate the original base style object.
 */
export function withFocusIndicator<T extends Record<string, unknown>>(
  baseStyle: T,
  isFocused: boolean,
): T & Partial<typeof FOCUS_INDICATOR_STYLE> {
  if (!isFocused) {
    return { ...baseStyle };
  }
  return { ...baseStyle, ...FOCUS_INDICATOR_STYLE };
}

// ---------------------------------------------------------------------------
// Tab order
// ---------------------------------------------------------------------------

/** Represents a focusable element with an explicit tab order position. */
export interface TabOrderItem {
  /** Unique element identifier. */
  id: string;
  /** Lower values receive focus earlier (like the HTML tabIndex attribute). */
  tabIndex: number;
}

/**
 * Returns a new array of tab-order items sorted in ascending tabIndex order.
 * Items with equal tabIndex values retain their original relative order (stable sort).
 * The original array is never mutated.
 */
export function sortByTabOrder(items: TabOrderItem[]): TabOrderItem[] {
  return [...items].sort((a, b) => a.tabIndex - b.tabIndex);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

export type KeyboardModifier = 'ctrl' | 'alt' | 'shift' | 'meta';

/** Describes a single keyboard shortcut. */
export interface KeyboardShortcut {
  /** The primary key (e.g. 'Tab', 'Enter', 'ArrowDown', 'S'). */
  key: string;
  /** Optional modifier key. */
  modifier?: KeyboardModifier;
  /** Human-readable description shown in help overlays. */
  description: string;
  /** Opaque action identifier used to dispatch the correct handler. */
  action: string;
}

/**
 * Default keyboard shortcuts for the application.
 * All keys follow the KeyboardEvent.key convention.
 */
export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { key: 'Tab', description: 'Move focus to next element', action: 'focusNext' },
  {
    key: 'Tab',
    modifier: 'shift',
    description: 'Move focus to previous element',
    action: 'focusPrev',
  },
  { key: 'Enter', description: 'Activate focused element', action: 'activate' },
  { key: ' ', description: 'Activate focused element (Space)', action: 'activate' },
  { key: 'Escape', description: 'Dismiss modal or go back', action: 'dismiss' },
  { key: 'ArrowUp', description: 'Navigate to previous item in list', action: 'prevItem' },
  { key: 'ArrowDown', description: 'Navigate to next item in list', action: 'nextItem' },
  { key: 'Home', description: 'Jump to first item in list', action: 'firstItem' },
  { key: 'End', description: 'Jump to last item in list', action: 'lastItem' },
];

/** Builds a canonical composite key string for a shortcut. */
function buildShortcutKey(key: string, modifier?: KeyboardModifier): string {
  return modifier ? `${modifier}+${key}` : key;
}

/**
 * Registry for application-level keyboard shortcuts.
 * Supports register, unregister, and lookup by key/modifier combination.
 */
export class KeyboardShortcutRegistry {
  private readonly shortcuts = new Map<string, KeyboardShortcut>();

  /** Registers a shortcut. Overwrites any existing shortcut with the same key combination. */
  register(shortcut: KeyboardShortcut): void {
    const compositeKey = buildShortcutKey(shortcut.key, shortcut.modifier);
    this.shortcuts.set(compositeKey, shortcut);
  }

  /** Removes a registered shortcut. No-op if the shortcut does not exist. */
  unregister(key: string, modifier?: KeyboardModifier): void {
    const compositeKey = buildShortcutKey(key, modifier);
    this.shortcuts.delete(compositeKey);
  }

  /** Returns the shortcut for a given key/modifier, or undefined if not registered. */
  getShortcut(key: string, modifier?: KeyboardModifier): KeyboardShortcut | undefined {
    const compositeKey = buildShortcutKey(key, modifier);
    return this.shortcuts.get(compositeKey);
  }

  /** Returns all currently registered shortcuts. */
  getAll(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /** Removes all registered shortcuts. */
  clear(): void {
    this.shortcuts.clear();
  }
}

// ---------------------------------------------------------------------------
// Accessibility props
// ---------------------------------------------------------------------------

/**
 * Subset of React Native accessibility roles relevant to PetChain screens.
 * Matches the AccessibilityRole type from @types/react-native.
 */
export type AccessibilityRole =
  | 'none'
  | 'button'
  | 'link'
  | 'search'
  | 'image'
  | 'keyboardkey'
  | 'text'
  | 'adjustable'
  | 'imagebutton'
  | 'header'
  | 'summary'
  | 'alert'
  | 'checkbox'
  | 'combobox'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'progressbar'
  | 'radio'
  | 'radiogroup'
  | 'scrollbar'
  | 'spinbutton'
  | 'switch'
  | 'tab'
  | 'tablist'
  | 'timer'
  | 'toolbar';

export interface AccessibilityState {
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  busy?: boolean;
  expanded?: boolean;
}

export interface AccessibilityProps {
  accessible: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
}

export interface AccessibilityOptions {
  hint?: string;
  role?: AccessibilityRole;
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  busy?: boolean;
  expanded?: boolean;
}

/**
 * Generates a complete set of React Native accessibility props for a component.
 *
 * @param label - A concise label that screen readers and keyboard navigation announce.
 * @param opts  - Optional configuration for hint, role, and state flags.
 */
export function createAccessibilityProps(
  label: string,
  opts?: AccessibilityOptions,
): AccessibilityProps {
  const props: AccessibilityProps = {
    accessible: true,
    accessibilityLabel: label,
  };

  if (opts?.hint !== undefined) {
    props.accessibilityHint = opts.hint;
  }

  if (opts?.role !== undefined) {
    props.accessibilityRole = opts.role;
  }

  const stateKeys: Array<keyof AccessibilityState> = [
    'disabled',
    'selected',
    'checked',
    'busy',
    'expanded',
  ];

  let hasState = false;
  const state: AccessibilityState = {};

  for (const key of stateKeys) {
    if (opts?.[key] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state as any)[key] = opts[key];
      hasState = true;
    }
  }

  if (hasState) {
    props.accessibilityState = state;
  }

  return props;
}

// ---------------------------------------------------------------------------
// Focus trap
// ---------------------------------------------------------------------------

/**
 * Manages a cycling focus trap within a bounded set of focusable element IDs.
 * Useful for modals, drawers, and dialogs that should constrain keyboard focus.
 */
export class FocusTrap {
  private focusableIds: string[] = [];
  private currentIndex = -1;

  /**
   * Replaces the set of focusable element IDs and resets focus to the first element.
   * Pass an empty array to disable the trap.
   */
  setFocusableElements(ids: string[]): void {
    this.focusableIds = [...ids];
    this.currentIndex = ids.length > 0 ? 0 : -1;
  }

  /**
   * Moves focus to the next element, wrapping around at the end.
   * Returns the ID of the newly focused element, or null when empty.
   */
  focusNext(): string | null {
    if (this.focusableIds.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.focusableIds.length;
    return this.focusableIds[this.currentIndex];
  }

  /**
   * Moves focus to the previous element, wrapping around at the start.
   * Returns the ID of the newly focused element, or null when empty.
   */
  focusPrev(): string | null {
    if (this.focusableIds.length === 0) return null;
    this.currentIndex =
      (this.currentIndex - 1 + this.focusableIds.length) % this.focusableIds.length;
    return this.focusableIds[this.currentIndex];
  }

  /** Returns the ID of the currently focused element, or null when empty. */
  getCurrentFocused(): string | null {
    if (this.currentIndex < 0 || this.focusableIds.length === 0) return null;
    return this.focusableIds[this.currentIndex];
  }

  /** Resets focus back to the first element in the trap. */
  reset(): void {
    this.currentIndex = this.focusableIds.length > 0 ? 0 : -1;
  }

  /** Returns the total number of focusable elements in the trap. */
  get size(): number {
    return this.focusableIds.length;
  }
}
