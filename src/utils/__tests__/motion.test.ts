import { AccessibilityInfo } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  allowDecorativeAnimation,
  chartDrawProgress,
  motionDuration,
  resolveTransition,
  useReducedMotion,
} from '../motion';

jest.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: jest.fn().mockResolvedValue(false),
    addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  },
}));

const mockIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled as jest.Mock;
const mockAddEventListener = AccessibilityInfo.addEventListener as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsReduceMotionEnabled.mockResolvedValue(false);
  mockAddEventListener.mockReturnValue({ remove: jest.fn() });
});

describe('motion — reduced motion policy (issue #981)', () => {
  it('collapses transition duration to 0 when reduce motion is on', () => {
    expect(motionDuration(300, false)).toBe(300);
    expect(motionDuration(300, true)).toBe(0);
  });

  it('keeps the end state but disables movement for navigation transitions', () => {
    expect(resolveTransition(250, false)).toEqual({
      duration: 250,
      useNativeDriver: true,
      animationEnabled: true,
    });
    expect(resolveTransition(250, true)).toEqual({
      duration: 0,
      useNativeDriver: true,
      animationEnabled: false,
    });
  });

  it('disables decorative / looping / gesture-driven animation when reduce motion is on', () => {
    expect(allowDecorativeAnimation(false)).toBe(true);
    expect(allowDecorativeAnimation(true)).toBe(false);
  });

  it('draws charts to their final frame instead of easing when reduce motion is on', () => {
    expect(chartDrawProgress(false)).toBe(0);
    expect(chartDrawProgress(true)).toBe(1);
  });
});

describe('useReducedMotion', () => {
  it('defaults to false before the async preference resolves', () => {
    mockIsReduceMotionEnabled.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('reflects the OS preference and subscribes to changes', async () => {
    mockIsReduceMotionEnabled.mockResolvedValue(true);
    const { result } = renderHook(() => useReducedMotion());

    await waitFor(() => expect(result.current).toBe(true));
    expect(mockAddEventListener).toHaveBeenCalledWith(
      'reduceMotionChanged',
      expect.any(Function),
    );
  });

  it('updates live when the preference changes (background/foreground toggle)', async () => {
    const { result } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));

    const handler = mockAddEventListener.mock.calls[0][1] as (v: boolean) => void;
    act(() => handler(true));
    expect(result.current).toBe(true);
  });

  it('removes its listener on unmount', async () => {
    const remove = jest.fn();
    mockAddEventListener.mockReturnValue({ remove });
    const { unmount } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(mockAddEventListener).toHaveBeenCalled());
    unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('keeps motion enabled if the preference cannot be read', async () => {
    mockIsReduceMotionEnabled.mockRejectedValue(new Error('unsupported'));
    const { result } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(mockAddEventListener).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
