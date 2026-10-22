import {
  FOCUS_INDICATOR_STYLE,
  withFocusIndicator,
  sortByTabOrder,
  DEFAULT_KEYBOARD_SHORTCUTS,
  KeyboardShortcutRegistry,
  createAccessibilityProps,
  FocusTrap,
} from '../keyboardNavigation';

// ---------------------------------------------------------------------------
// FOCUS_INDICATOR_STYLE
// ---------------------------------------------------------------------------

describe('FOCUS_INDICATOR_STYLE', () => {
  it('has a numeric borderWidth', () => {
    expect(typeof FOCUS_INDICATOR_STYLE.borderWidth).toBe('number');
    expect(FOCUS_INDICATOR_STYLE.borderWidth).toBeGreaterThan(0);
  });

  it('has a non-empty borderColor string', () => {
    expect(typeof FOCUS_INDICATOR_STYLE.borderColor).toBe('string');
    expect(FOCUS_INDICATOR_STYLE.borderColor.length).toBeGreaterThan(0);
  });

  it('has a numeric borderRadius', () => {
    expect(typeof FOCUS_INDICATOR_STYLE.borderRadius).toBe('number');
  });

  it('has a numeric elevation for Android', () => {
    expect(typeof FOCUS_INDICATOR_STYLE.elevation).toBe('number');
    expect(FOCUS_INDICATOR_STYLE.elevation).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// withFocusIndicator
// ---------------------------------------------------------------------------

describe('withFocusIndicator', () => {
  it('returns a copy of the base style when not focused', () => {
    const base = { backgroundColor: '#fff', padding: 10 };
    const result = withFocusIndicator(base, false);
    expect(result).toEqual(base);
  });

  it('merges focus indicator styles into the base style when focused', () => {
    const base = { backgroundColor: '#fff' };
    const result = withFocusIndicator(base, true);
    expect(result.backgroundColor).toBe('#fff');
    expect(result.borderWidth).toBe(FOCUS_INDICATOR_STYLE.borderWidth);
    expect(result.borderColor).toBe(FOCUS_INDICATOR_STYLE.borderColor);
    expect(result.elevation).toBe(FOCUS_INDICATOR_STYLE.elevation);
  });

  it('does not mutate the original base style object', () => {
    const base = { backgroundColor: '#fff' };
    const snapshot = { ...base };
    withFocusIndicator(base, true);
    expect(base).toEqual(snapshot);
  });

  it('unfocused result does not contain focus indicator keys', () => {
    const base = { padding: 8 };
    const result = withFocusIndicator(base, false);
    expect((result as Record<string, unknown>).shadowColor).toBeUndefined();
    expect((result as Record<string, unknown>).shadowOpacity).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sortByTabOrder
// ---------------------------------------------------------------------------

describe('sortByTabOrder', () => {
  it('returns an empty array when given an empty input', () => {
    expect(sortByTabOrder([])).toEqual([]);
  });

  it('sorts items by tabIndex in ascending order', () => {
    const items = [
      { id: 'c', tabIndex: 3 },
      { id: 'a', tabIndex: 1 },
      { id: 'b', tabIndex: 2 },
    ];
    const sorted = sortByTabOrder(items);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves a single-element array unchanged', () => {
    expect(sortByTabOrder([{ id: 'x', tabIndex: 5 }])).toEqual([{ id: 'x', tabIndex: 5 }]);
  });

  it('does not mutate the original array', () => {
    const items = [
      { id: 'b', tabIndex: 2 },
      { id: 'a', tabIndex: 1 },
    ];
    const original = [...items];
    sortByTabOrder(items);
    expect(items).toEqual(original);
  });

  it('preserves relative order for items with equal tabIndex (stable sort)', () => {
    const items = [
      { id: 'x', tabIndex: 1 },
      { id: 'y', tabIndex: 1 },
      { id: 'z', tabIndex: 2 },
    ];
    const sorted = sortByTabOrder(items);
    expect(sorted[0].id).toBe('x');
    expect(sorted[1].id).toBe('y');
    expect(sorted[2].id).toBe('z');
  });

  it('handles negative tabIndex values', () => {
    const items = [
      { id: 'b', tabIndex: 0 },
      { id: 'a', tabIndex: -1 },
      { id: 'c', tabIndex: 1 },
    ];
    const sorted = sortByTabOrder(items);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_KEYBOARD_SHORTCUTS
// ---------------------------------------------------------------------------

describe('DEFAULT_KEYBOARD_SHORTCUTS', () => {
  it('contains at least 4 shortcuts', () => {
    expect(DEFAULT_KEYBOARD_SHORTCUTS.length).toBeGreaterThanOrEqual(4);
  });

  it('every shortcut has a non-empty key, description, and action', () => {
    for (const shortcut of DEFAULT_KEYBOARD_SHORTCUTS) {
      expect(typeof shortcut.key).toBe('string');
      expect(shortcut.key.length).toBeGreaterThan(0);
      expect(typeof shortcut.description).toBe('string');
      expect(shortcut.description.length).toBeGreaterThan(0);
      expect(typeof shortcut.action).toBe('string');
      expect(shortcut.action.length).toBeGreaterThan(0);
    }
  });

  it('includes a Tab shortcut for the focusNext action', () => {
    const tab = DEFAULT_KEYBOARD_SHORTCUTS.find((s) => s.key === 'Tab' && !s.modifier);
    expect(tab).toBeDefined();
    expect(tab?.action).toBe('focusNext');
  });

  it('includes a Shift+Tab shortcut for the focusPrev action', () => {
    const shiftTab = DEFAULT_KEYBOARD_SHORTCUTS.find(
      (s) => s.key === 'Tab' && s.modifier === 'shift',
    );
    expect(shiftTab).toBeDefined();
    expect(shiftTab?.action).toBe('focusPrev');
  });

  it('includes an Escape shortcut for the dismiss action', () => {
    const esc = DEFAULT_KEYBOARD_SHORTCUTS.find((s) => s.key === 'Escape');
    expect(esc).toBeDefined();
    expect(esc?.action).toBe('dismiss');
  });

  it('includes ArrowDown for nextItem action', () => {
    const down = DEFAULT_KEYBOARD_SHORTCUTS.find((s) => s.key === 'ArrowDown');
    expect(down).toBeDefined();
    expect(down?.action).toBe('nextItem');
  });

  it('includes ArrowUp for prevItem action', () => {
    const up = DEFAULT_KEYBOARD_SHORTCUTS.find((s) => s.key === 'ArrowUp');
    expect(up).toBeDefined();
    expect(up?.action).toBe('prevItem');
  });
});

// ---------------------------------------------------------------------------
// KeyboardShortcutRegistry
// ---------------------------------------------------------------------------

describe('KeyboardShortcutRegistry', () => {
  let registry: KeyboardShortcutRegistry;

  beforeEach(() => {
    registry = new KeyboardShortcutRegistry();
  });

  it('starts empty', () => {
    expect(registry.getAll()).toHaveLength(0);
  });

  it('registers and retrieves a shortcut without a modifier', () => {
    registry.register({ key: 'Enter', description: 'Submit', action: 'submit' });
    const shortcut = registry.getShortcut('Enter');
    expect(shortcut).toBeDefined();
    expect(shortcut?.action).toBe('submit');
  });

  it('registers and retrieves a shortcut with a modifier', () => {
    registry.register({ key: 'S', modifier: 'ctrl', description: 'Save', action: 'save' });
    const shortcut = registry.getShortcut('S', 'ctrl');
    expect(shortcut).toBeDefined();
    expect(shortcut?.action).toBe('save');
  });

  it('returns undefined for an unregistered shortcut', () => {
    expect(registry.getShortcut('X')).toBeUndefined();
    expect(registry.getShortcut('X', 'ctrl')).toBeUndefined();
  });

  it('treats key with modifier and same key without modifier as different entries', () => {
    registry.register({ key: 'A', description: 'Without modifier', action: 'no_mod' });
    registry.register({ key: 'A', modifier: 'ctrl', description: 'With Ctrl', action: 'with_mod' });
    expect(registry.getShortcut('A')?.action).toBe('no_mod');
    expect(registry.getShortcut('A', 'ctrl')?.action).toBe('with_mod');
    expect(registry.getAll()).toHaveLength(2);
  });

  it('overwrites an existing shortcut with the same key combination', () => {
    registry.register({ key: 'D', description: 'Delete v1', action: 'delete_v1' });
    registry.register({ key: 'D', description: 'Delete v2', action: 'delete_v2' });
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getShortcut('D')?.action).toBe('delete_v2');
  });

  it('unregisters a shortcut', () => {
    registry.register({ key: 'D', description: 'Delete', action: 'delete' });
    registry.unregister('D');
    expect(registry.getShortcut('D')).toBeUndefined();
    expect(registry.getAll()).toHaveLength(0);
  });

  it('unregisters a shortcut with a modifier', () => {
    registry.register({ key: 'Z', modifier: 'ctrl', description: 'Undo', action: 'undo' });
    registry.unregister('Z', 'ctrl');
    expect(registry.getShortcut('Z', 'ctrl')).toBeUndefined();
  });

  it('unregister is a no-op for non-existent shortcuts', () => {
    expect(() => registry.unregister('Unknown')).not.toThrow();
  });

  it('returns all registered shortcuts', () => {
    registry.register({ key: 'A', description: 'Add', action: 'add' });
    registry.register({ key: 'B', description: 'Back', action: 'back' });
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    const actions = all.map((s) => s.action).sort();
    expect(actions).toEqual(['add', 'back']);
  });

  it('clears all shortcuts', () => {
    registry.register({ key: 'A', description: 'Add', action: 'add' });
    registry.register({ key: 'B', description: 'Back', action: 'back' });
    registry.clear();
    expect(registry.getAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createAccessibilityProps
// ---------------------------------------------------------------------------

describe('createAccessibilityProps', () => {
  it('creates props with accessible=true and the given label', () => {
    const props = createAccessibilityProps('Login button');
    expect(props.accessible).toBe(true);
    expect(props.accessibilityLabel).toBe('Login button');
  });

  it('omits optional fields when no options are provided', () => {
    const props = createAccessibilityProps('Button');
    expect(props.accessibilityHint).toBeUndefined();
    expect(props.accessibilityRole).toBeUndefined();
    expect(props.accessibilityState).toBeUndefined();
  });

  it('includes hint when provided', () => {
    const props = createAccessibilityProps('Submit', { hint: 'Submits the registration form' });
    expect(props.accessibilityHint).toBe('Submits the registration form');
  });

  it('includes role when provided', () => {
    const props = createAccessibilityProps('Search pets', { role: 'search' });
    expect(props.accessibilityRole).toBe('search');
  });

  it('includes button role', () => {
    const props = createAccessibilityProps('Delete pet', { role: 'button' });
    expect(props.accessibilityRole).toBe('button');
  });

  it('includes disabled state', () => {
    const props = createAccessibilityProps('Save', { disabled: true });
    expect(props.accessibilityState?.disabled).toBe(true);
  });

  it('includes selected state', () => {
    const props = createAccessibilityProps('Tab 1', { selected: true });
    expect(props.accessibilityState?.selected).toBe(true);
  });

  it('includes checked state', () => {
    const props = createAccessibilityProps('Checkbox', { checked: true });
    expect(props.accessibilityState?.checked).toBe(true);
  });

  it('supports mixed checked state for indeterminate checkboxes', () => {
    const props = createAccessibilityProps('Select all', { checked: 'mixed' });
    expect(props.accessibilityState?.checked).toBe('mixed');
  });

  it('includes busy state', () => {
    const props = createAccessibilityProps('Loading', { busy: true });
    expect(props.accessibilityState?.busy).toBe(true);
  });

  it('includes expanded state', () => {
    const props = createAccessibilityProps('Accordion', { expanded: false });
    expect(props.accessibilityState?.expanded).toBe(false);
  });

  it('includes multiple state flags simultaneously', () => {
    const props = createAccessibilityProps('Item', { disabled: true, selected: true });
    expect(props.accessibilityState?.disabled).toBe(true);
    expect(props.accessibilityState?.selected).toBe(true);
  });

  it('does not set accessibilityState when only hint and role are provided', () => {
    const props = createAccessibilityProps('Nav', { hint: 'Go back', role: 'button' });
    expect(props.accessibilityState).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FocusTrap
// ---------------------------------------------------------------------------

describe('FocusTrap', () => {
  let trap: FocusTrap;

  beforeEach(() => {
    trap = new FocusTrap();
  });

  it('has size 0 initially', () => {
    expect(trap.size).toBe(0);
  });

  it('returns null for getCurrentFocused when empty', () => {
    expect(trap.getCurrentFocused()).toBeNull();
  });

  it('returns null for focusNext when empty', () => {
    expect(trap.focusNext()).toBeNull();
  });

  it('returns null for focusPrev when empty', () => {
    expect(trap.focusPrev()).toBeNull();
  });

  it('sets focusable elements and reports correct size', () => {
    trap.setFocusableElements(['email', 'password', 'submit']);
    expect(trap.size).toBe(3);
  });

  it('starts focus on the first element after setFocusableElements', () => {
    trap.setFocusableElements(['input1', 'input2', 'btn']);
    expect(trap.getCurrentFocused()).toBe('input1');
  });

  it('advances focus forward, wrapping at the end', () => {
    trap.setFocusableElements(['a', 'b', 'c']);
    expect(trap.focusNext()).toBe('b');
    expect(trap.focusNext()).toBe('c');
    expect(trap.focusNext()).toBe('a'); // wraps around
  });

  it('moves focus backward, wrapping at the start', () => {
    trap.setFocusableElements(['a', 'b', 'c']);
    expect(trap.focusPrev()).toBe('c'); // wraps from index 0 to last
    expect(trap.focusPrev()).toBe('b');
    expect(trap.focusPrev()).toBe('a');
  });

  it('resets focus to the first element', () => {
    trap.setFocusableElements(['x', 'y', 'z']);
    trap.focusNext();
    trap.focusNext();
    trap.reset();
    expect(trap.getCurrentFocused()).toBe('x');
  });

  it('handles a single element without errors on forward navigation', () => {
    trap.setFocusableElements(['only']);
    expect(trap.focusNext()).toBe('only');
    expect(trap.focusNext()).toBe('only');
  });

  it('handles a single element without errors on backward navigation', () => {
    trap.setFocusableElements(['only']);
    expect(trap.focusPrev()).toBe('only');
  });

  it('replacing elements resets focus to the new first element', () => {
    trap.setFocusableElements(['old1', 'old2']);
    trap.focusNext();
    trap.setFocusableElements(['new1', 'new2', 'new3']);
    expect(trap.getCurrentFocused()).toBe('new1');
  });

  it('setting an empty element list makes size 0 and returns null', () => {
    trap.setFocusableElements(['a', 'b']);
    trap.setFocusableElements([]);
    expect(trap.size).toBe(0);
    expect(trap.getCurrentFocused()).toBeNull();
    expect(trap.focusNext()).toBeNull();
  });

  it('does not mutate the provided ids array', () => {
    const ids = ['a', 'b', 'c'];
    const snapshot = [...ids];
    trap.setFocusableElements(ids);
    trap.focusNext();
    expect(ids).toEqual(snapshot);
  });
});
