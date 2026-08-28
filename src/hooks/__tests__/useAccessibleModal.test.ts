import { AccessibilityInfo, BackHandler } from 'react-native';
import { renderHook } from '@testing-library/react-native';

import { modalStack, useAccessibleModal } from '../useAccessibleModal';

jest.mock('react-native', () => ({
  AccessibilityInfo: {
    setAccessibilityFocus: jest.fn(),
    announceForAccessibility: jest.fn(),
  },
  BackHandler: { addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }) },
  findNodeHandle: jest.fn(() => 7),
}));

const mockBack = BackHandler.addEventListener as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  modalStack._reset();
  mockBack.mockReturnValue({ remove: jest.fn() });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('modalStack (issue #980)', () => {
  it('tracks nested modals and reports the top one', () => {
    modalStack.push('a');
    modalStack.push('b');
    expect(modalStack.depth()).toBe(2);
    expect(modalStack.top()).toBe('b');
    expect(modalStack.isTop('b')).toBe(true);
    expect(modalStack.isTop('a')).toBe(false);

    modalStack.remove('b');
    expect(modalStack.isTop('a')).toBe(true);
  });

  it('is idempotent on repeated push/remove', () => {
    modalStack.push('a');
    modalStack.push('a');
    modalStack.remove('a');
    modalStack.remove('a');
    expect(modalStack.depth()).toBe(0);
  });
});

describe('useAccessibleModal', () => {
  it('returns modal props that route Android back and escape to onClose', () => {
    const onClose = jest.fn();
    const { result } = renderHook(() => useAccessibleModal({ visible: true, onClose }));

    expect(result.current).toMatchObject({
      visible: true,
      transparent: true,
      accessibilityViewIsModal: true,
    });
    result.current.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves screen-reader focus to the title when it opens', () => {
    const titleRef = { current: {} } as React.RefObject<never>;
    renderHook(() =>
      useAccessibleModal({ visible: true, onClose: jest.fn(), titleRef, announcement: 'Snooze reminder dialog' }),
    );
    jest.advanceTimersByTime(150);
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Snooze reminder dialog');
  });

  it('restores focus to the trigger element on close (focus restore)', () => {
    const returnFocusRef = { current: {} } as React.RefObject<never>;
    const { rerender } = renderHook(
      ({ visible }) => useAccessibleModal({ visible, onClose: jest.fn(), returnFocusRef }),
      { initialProps: { visible: true } },
    );
    jest.advanceTimersByTime(150);
    (AccessibilityInfo.setAccessibilityFocus as jest.Mock).mockClear();

    rerender({ visible: false });
    jest.advanceTimersByTime(100);
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7);
  });

  it('only the top-most nested modal consumes the hardware back press', () => {
    const parentClose = jest.fn();
    const childClose = jest.fn();
    renderHook(() => useAccessibleModal({ visible: true, onClose: parentClose }));
    renderHook(() => useAccessibleModal({ visible: true, onClose: childClose }));

    // last registered handler belongs to the child (top of stack)
    const childHandler = mockBack.mock.calls[mockBack.mock.calls.length - 1][1] as () => boolean;
    const parentHandler = mockBack.mock.calls[0][1] as () => boolean;

    expect(parentHandler()).toBe(false);
    expect(parentClose).not.toHaveBeenCalled();

    expect(childHandler()).toBe(true);
    expect(childClose).toHaveBeenCalledTimes(1);
  });

  it('deregisters from the stack on unmount', () => {
    const { unmount } = renderHook(() => useAccessibleModal({ visible: true, onClose: jest.fn() }));
    expect(modalStack.depth()).toBe(1);
    unmount();
    expect(modalStack.depth()).toBe(0);
  });
});
