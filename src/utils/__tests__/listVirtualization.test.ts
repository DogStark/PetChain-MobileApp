jest.mock('react-native', () => ({}), { virtual: true });

(global as any).__DEV__ = true;

import {
  fixedItemLayout,
  preserveScrollAnchor,
  stableKeyExtractor,
  variableItemLayout,
  virtualizedListProps,
  VIRTUALIZATION_PRESETS,
} from '../listVirtualization';

describe('virtualizedListProps', () => {
  it('defaults to the "long" preset', () => {
    expect(virtualizedListProps()).toBe(VIRTUALIZATION_PRESETS.long);
  });

  it('retains fewer cells for larger lists', () => {
    expect(VIRTUALIZATION_PRESETS.huge.windowSize).toBeLessThan(
      VIRTUALIZATION_PRESETS.long.windowSize,
    );
    expect(VIRTUALIZATION_PRESETS.long.windowSize).toBeLessThan(
      VIRTUALIZATION_PRESETS.default.windowSize,
    );
  });

  it('always clips off-screen rows', () => {
    for (const preset of Object.values(VIRTUALIZATION_PRESETS)) {
      expect(preset.removeClippedSubviews).toBe(true);
    }
  });
});

describe('stableKeyExtractor', () => {
  it('prefers a domain id over the index', () => {
    expect(stableKeyExtractor({ id: 42 }, 0)).toBe('42');
    expect(stableKeyExtractor({ _id: 'rec_1' }, 3)).toBe('rec_1');
    expect(stableKeyExtractor({ uuid: 'abc' }, 9)).toBe('abc');
  });

  it('falls back to an index key and warns once in dev', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(stableKeyExtractor({}, 5)).toBe('idx-5');
    expect(stableKeyExtractor({}, 6)).toBe('idx-6');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('fixedItemLayout', () => {
  it('computes constant-time offsets with a header', () => {
    const layout = fixedItemLayout(80, 120);
    expect(layout(null, 0)).toEqual({ length: 80, offset: 120, index: 0 });
    expect(layout(null, 3)).toEqual({ length: 80, offset: 120 + 240, index: 3 });
  });
});

describe('variableItemLayout', () => {
  it('accumulates per-row heights', () => {
    const data = [{ h: 10 }, { h: 20 }, { h: 30 }];
    const layout = variableItemLayout(data, (it) => it.h, 5);
    expect(layout(null, 0)).toEqual({ length: 10, offset: 5, index: 0 });
    expect(layout(null, 1)).toEqual({ length: 20, offset: 15, index: 1 });
    expect(layout(null, 2)).toEqual({ length: 30, offset: 35, index: 2 });
  });
});

describe('preserveScrollAnchor', () => {
  it('keeps the viewport on the same item when rows are prepended', () => {
    const prev = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const next = [{ id: 'x' }, { id: 'y' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(preserveScrollAnchor(prev, next, 0)).toBe(2);
  });

  it('clamps when the anchored item disappears', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'b' }];
    expect(preserveScrollAnchor(prev, next, 0)).toBe(0);
  });
});
