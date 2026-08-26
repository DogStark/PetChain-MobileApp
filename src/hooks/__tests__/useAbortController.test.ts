/**
 * #975 — Standardize API cancellation on screen unmount.
 *
 * Characterizes the stale-screen hazard (a request that outlives its screen)
 * and verifies the hook cancels on unmount and on rapid filter/navigation
 * changes so only the newest request can settle.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useAbortController, isAbortError, ignoreAbort } from '../useAbortController';

describe('#975 useAbortController', () => {
  it('reproduces the hazard: without cancellation a slow request still resolves after unmount', async () => {
    let resolveLate: (v: string) => void = () => {};
    const slow = new Promise<string>((r) => {
      resolveLate = r;
    });
    const { unmount } = renderHook(() => null);
    unmount();
    resolveLate('stale payload');
    await expect(slow).resolves.toBe('stale payload'); // nothing stopped it
  });

  it('aborts the active signal on unmount', () => {
    const { result, unmount } = renderHook(() => useAbortController());
    const signal = result.current.getSignal();
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('renew() aborts the previous scope and returns a fresh, un-aborted signal', () => {
    const { result } = renderHook(() => useAbortController());
    const first = result.current.getSignal();

    let second: AbortSignal = first;
    act(() => {
      second = result.current.renew();
    });

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(second).not.toBe(first);
  });

  it('rapid filter changes: only the last scope survives', () => {
    const { result } = renderHook(() => useAbortController());
    const signals: AbortSignal[] = [result.current.getSignal()];

    act(() => {
      for (let i = 0; i < 5; i++) signals.push(result.current.renew());
    });

    const last = signals.pop()!;
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(last.aborted).toBe(false);
  });

  it('isAbortError / ignoreAbort recognize abort rejections and rethrow the rest', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);

    expect(() => ignoreAbort({ name: 'CanceledError' })).not.toThrow();
    expect(() => ignoreAbort(new Error('boom'))).toThrow('boom');
  });
});
