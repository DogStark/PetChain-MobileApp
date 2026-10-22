jest.mock('react-native', () => ({
  I18nManager: { isRTL: false },
}));

import { I18nManager } from 'react-native';

import {
  backChevron,
  directionForLanguage,
  directionalSign,
  directionalValue,
  forwardChevron,
  physicalEdge,
  rowDirection,
  textAlign,
} from '../rtl';

const setRTL = (v: boolean) => ((I18nManager as any).isRTL = v);

afterEach(() => setRTL(false));

describe('LTR (English) navigation + clinical forms', () => {
  it('lays rows and text out left-to-right', () => {
    expect(rowDirection()).toBe('row');
    expect(textAlign('start')).toBe('left');
    expect(textAlign('end')).toBe('right');
  });

  it('points the forward chevron right and back chevron left', () => {
    expect(forwardChevron()).toBe('chevron-right');
    expect(backChevron()).toBe('chevron-left');
  });

  it('maps logical edges and swipe sign for LTR', () => {
    expect(physicalEdge('start')).toBe('left');
    expect(physicalEdge('end')).toBe('right');
    expect(directionalSign()).toBe(1);
  });
});

describe('RTL (Arabic) navigation + clinical forms', () => {
  beforeEach(() => setRTL(true));

  it('mirrors row and text alignment', () => {
    expect(rowDirection()).toBe('row-reverse');
    expect(textAlign('start')).toBe('right');
    expect(textAlign('end')).toBe('left');
    expect(textAlign('center')).toBe('center');
  });

  it('mirrors navigation chevrons so "forward" still reads as forward', () => {
    expect(forwardChevron()).toBe('chevron-left');
    expect(backChevron()).toBe('chevron-right');
  });

  it('mirrors logical edges, gesture sign and reverse rows', () => {
    expect(physicalEdge('start')).toBe('right');
    expect(physicalEdge('end')).toBe('left');
    expect(directionalSign()).toBe(-1);
    expect(rowDirection(true)).toBe('row'); // reverse of RTL is LTR row
  });

  it('still returns the explicitly-requested value from directionalValue', () => {
    expect(directionalValue('a', 'b')).toBe('b');
  });
});

describe('directionForLanguage', () => {
  it('resolves per-locale direction without touching global state', () => {
    expect(directionForLanguage('en')).toBe('ltr');
    expect(directionForLanguage('es')).toBe('ltr');
    expect(directionForLanguage('ar')).toBe('rtl');
  });
});
