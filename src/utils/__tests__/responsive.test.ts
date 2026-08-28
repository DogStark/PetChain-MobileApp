// Mock react-native Dimensions before importing the module
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Dimensions: {
      get: jest.fn(),
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
    Platform: { OS: 'ios' },
    PixelRatio: { roundToNearestPixel: (n: number) => Math.round(n) },
  };
});

import { Dimensions } from 'react-native';

import { scale, verticalScale, moderateScale, breakpoint, gridItemWidth } from '../responsive';

const mockDimensions = Dimensions.get as jest.Mock;

describe('scale', () => {
  it('returns the base size on a 393px-wide screen', () => {
    mockDimensions.mockReturnValue({ width: 393, height: 852 });
    expect(scale(100)).toBeCloseTo(100, 0);
  });

  it('scales up on a wider screen', () => {
    mockDimensions.mockReturnValue({ width: 786, height: 852 });
    expect(scale(100)).toBeCloseTo(200, 0);
  });
});

describe('verticalScale', () => {
  it('returns base size on 852px-tall screen', () => {
    mockDimensions.mockReturnValue({ width: 393, height: 852 });
    expect(verticalScale(100)).toBeCloseTo(100, 0);
  });
});

describe('moderateScale', () => {
  it('stays closer to original size with factor=0', () => {
    mockDimensions.mockReturnValue({ width: 786, height: 852 }); // 2x scale
    expect(moderateScale(100, 0)).toBeCloseTo(100, 0);
  });

  it('applies full scale with factor=1', () => {
    mockDimensions.mockReturnValue({ width: 786, height: 852 });
    expect(moderateScale(100, 1)).toBeCloseTo(200, 0);
  });
});

describe('breakpoint', () => {
  it('returns phone value for narrow screen', () => {
    mockDimensions.mockReturnValue({ width: 375, height: 812 });
    expect(breakpoint({ phone: 1, tablet: 2 })).toBe(1);
  });

  it('returns tablet value for wide screen', () => {
    mockDimensions.mockReturnValue({ width: 768, height: 1024 });
    expect(breakpoint({ phone: 1, tablet: 2 })).toBe(2);
  });

  it('returns desktop value when present', () => {
    mockDimensions.mockReturnValue({ width: 1024, height: 1366 });
    expect(breakpoint({ phone: 1, tablet: 2, desktop: 4 })).toBe(2); // 1024 short side < 1024 for desktop
  });
});

describe('gridItemWidth', () => {
  it('calculates correct item width for 2-column grid', () => {
    mockDimensions.mockReturnValue({ width: 400, height: 800 });
    // available = 400 - 32 - 16 = 352; width = 352 / 2 = 176
    expect(gridItemWidth(2, 16, 16)).toBeCloseTo(176, 0);
  });
});
