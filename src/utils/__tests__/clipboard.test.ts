import {
  copyWithTimeout,
  clearIfUnchanged,
  isSensitiveIdentifier,
  DEFAULT_CLIPBOARD_TIMEOUT_MS,
  type ClipboardAdapter,
} from '../clipboard';

function createMockAdapter(initial = ''): ClipboardAdapter & {
  getValue: () => string;
  setCalls: string[];
} {
  let value = initial;
  const setCalls: string[] = [];
  return {
    async getString() {
      return value;
    },
    async setString(text: string) {
      value = text;
      setCalls.push(text);
    },
    getValue: () => value,
    setCalls,
  };
}

describe('isSensitiveIdentifier', () => {
  it('flags wallet addresses and record references as sensitive', () => {
    expect(isSensitiveIdentifier('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
    expect(isSensitiveIdentifier('rec_01HZX8Y2K3M4N5P6Q7R8S9T0AB')).toBe(true);
  });

  it('does not flag ordinary labels', () => {
    expect(isSensitiveIdentifier('My savings account')).toBe(false);
  });
});

describe('copyWithTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes the exact value and reports what was copied', async () => {
    const adapter = createMockAdapter();
    const result = await copyWithTimeout(adapter, '0xabc', { timeoutMs: 1000 });

    expect(adapter.getValue()).toBe('0xabc');
    expect(result.copiedValue).toBe('0xabc');
    expect(result.timeoutMs).toBe(1000);
    expect(result.cleared).toBe(false);
  });

  it('clears the clipboard after the timeout when unchanged', async () => {
    const adapter = createMockAdapter();
    await copyWithTimeout(adapter, '0xabc', { timeoutMs: 1000 });

    await jest.advanceTimersByTimeAsync(1000);

    expect(adapter.getValue()).toBe('');
  });

  it('does not overwrite newer user clipboard content', async () => {
    const adapter = createMockAdapter();
    await copyWithTimeout(adapter, '0xabc', { timeoutMs: 1000 });

    await adapter.setString('user typed something else');
    await jest.advanceTimersByTimeAsync(1000);

    expect(adapter.getValue()).toBe('user typed something else');
  });

  it('uses the default timeout when none is provided', async () => {
    const adapter = createMockAdapter();
    const result = await copyWithTimeout(adapter, '0xabc');

    expect(result.timeoutMs).toBe(DEFAULT_CLIPBOARD_TIMEOUT_MS);
  });

  it('skips timeout cleanup when platform does not support it', async () => {
    const adapter = createMockAdapter();
    const result = await copyWithTimeout(adapter, '0xabc', { timeoutMs: 1000, supported: false });

    await jest.advanceTimersByTimeAsync(5000);

    expect(adapter.getValue()).toBe('0xabc');
    expect(result.cleared).toBe(false);
  });
});

describe('clearIfUnchanged', () => {
  it('clears only when the clipboard still matches the copied value', async () => {
    const adapter = createMockAdapter('0xabc');
    const cleared = await clearIfUnchanged(adapter, '0xabc');

    expect(cleared).toBe(true);
    expect(adapter.getValue()).toBe('');
  });

  it('leaves newer content untouched', async () => {
    const adapter = createMockAdapter('newer content');
    const cleared = await clearIfUnchanged(adapter, '0xabc');

    expect(cleared).toBe(false);
    expect(adapter.getValue()).toBe('newer content');
  });
});

describe('scheduleSensitiveClear (#1397)', () => {
  const {
    scheduleSensitiveClear,
    SENSITIVE_CLEAR_MS,
  } = require('../clipboard') as typeof import('../clipboard');

  function createAdapter(initial = '') {
    let value = initial;
    return {
      async readText() {
        return value;
      },
      async writeText(text: string) {
        value = text;
      },
      getValue: () => value,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears a sensitive value after 60 seconds', async () => {
    const adapter = createAdapter('recovery-code-123');
    const onCleared = jest.fn();
    scheduleSensitiveClear(adapter, 'recovery-code-123', { onCleared });

    expect(SENSITIVE_CLEAR_MS).toBe(60_000);
    await jest.advanceTimersByTimeAsync(59_000);
    expect(adapter.getValue()).toBe('recovery-code-123');

    await jest.advanceTimersByTimeAsync(1_000);
    expect(adapter.getValue()).toBe('');
    expect(onCleared).toHaveBeenCalledWith(true);
  });

  it('reports a per-second countdown for the toast', async () => {
    const adapter = createAdapter('sk_live_abc');
    const onTick = jest.fn();
    scheduleSensitiveClear(adapter, 'sk_live_abc', { onTick });

    expect(onTick).toHaveBeenLastCalledWith(60);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(onTick).toHaveBeenLastCalledWith(50);
  });

  it('does not clear content the user copied afterwards', async () => {
    const adapter = createAdapter('GABC...wallet');
    scheduleSensitiveClear(adapter, 'GABC...wallet');

    await adapter.writeText('something newer');
    await jest.advanceTimersByTimeAsync(60_000);

    expect(adapter.getValue()).toBe('something newer');
  });

  it('can be cancelled before the clipboard is cleared', async () => {
    const adapter = createAdapter('GABC...wallet');
    const cancel = scheduleSensitiveClear(adapter, 'GABC...wallet');

    cancel();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(adapter.getValue()).toBe('GABC...wallet');
  });
});
