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
