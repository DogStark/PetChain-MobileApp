jest.mock('react-native', () => ({
  Dimensions: { get: jest.fn(), addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

import { computeTwoPaneLayout, MASTER_PANE_WIDTH, TWO_PANE_MIN_WIDTH } from '../twoPaneLayout';

describe('computeTwoPaneLayout', () => {
  it('stays single-pane on a phone-width window', () => {
    const layout = computeTwoPaneLayout({ width: 390, height: 844 });
    expect(layout.isTwoPane).toBe(false);
    expect(layout.masterWidth).toBe(0);
    expect(layout.detailWidth).toBe(390);
    expect(layout.detailPresentation).toBe('push');
  });

  it('stays single-pane for a portrait tablet just below the threshold', () => {
    const layout = computeTwoPaneLayout({ width: TWO_PANE_MIN_WIDTH - 1, height: 1100 });
    expect(layout.isTwoPane).toBe(false);
  });

  it('splits into two panes on a landscape tablet', () => {
    const layout = computeTwoPaneLayout({ width: 1194, height: 834 });
    expect(layout.isTwoPane).toBe(true);
    expect(layout.masterWidth).toBe(MASTER_PANE_WIDTH);
    expect(layout.detailWidth).toBe(1194 - MASTER_PANE_WIDTH);
    expect(layout.detailPresentation).toBe('inline');
  });

  it('caps the master pane at ~42% on a narrow split-screen window', () => {
    const layout = computeTwoPaneLayout({ width: 740, height: 900 });
    expect(layout.isTwoPane).toBe(true);
    expect(layout.masterWidth).toBeLessThanOrEqual(Math.round(740 * 0.42));
    expect(layout.masterWidth + layout.detailWidth).toBe(740);
  });

  it('re-flows when the same screen is resized from split to full width', () => {
    const split = computeTwoPaneLayout({ width: 600, height: 900 });
    const full = computeTwoPaneLayout({ width: 1280, height: 900 });
    expect(split.isTwoPane).toBe(false);
    expect(full.isTwoPane).toBe(true);
  });
});
