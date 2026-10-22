import {
  formatCurrency,
  formatUnit,
  getCurrencyMeta,
  getUnitMeta,
} from '../formatCurrency';

describe('formatCurrency', () => {
  it('formats USD minor units deterministically', () => {
    expect(formatCurrency(1234, getCurrencyMeta('USD'))).toBe('$12.34');
  });

  it('formats zero and negative amounts', () => {
    expect(formatCurrency(0, getCurrencyMeta('USD'))).toBe('$0.00');
    expect(formatCurrency(-500, getCurrencyMeta('USD'))).toBe('-$5.00');
  });

  it('formats locales with different separators', () => {
    expect(formatCurrency(1234, getCurrencyMeta('EUR'))).toBe('12,34\u00a0\u20ac');
    expect(formatCurrency(1234, getCurrencyMeta('GBP'))).toBe('\u00a312.34');
  });

  it('handles currencies without minor units', () => {
    expect(formatCurrency(1500, getCurrencyMeta('JPY'))).toBe('\u00a51,500');
  });

  it('avoids floating-point rounding at boundary values', () => {
    expect(formatCurrency(1, getCurrencyMeta('USD'))).toBe('$0.01');
    expect(formatCurrency(999999999, getCurrencyMeta('USD'))).toBe('$9,999,999.99');
  });

  it('fails safely on invalid amounts', () => {
    expect(() => formatCurrency(1.5, getCurrencyMeta('USD'))).toThrow(TypeError);
    expect(() => formatCurrency(Number.NaN, getCurrencyMeta('USD'))).toThrow(TypeError);
  });

  it('fails safely on invalid currency metadata', () => {
    expect(() => getCurrencyMeta('XYZ')).toThrow(RangeError);
    expect(() =>
      formatCurrency(100, { code: 'USD', minorUnits: 0, locale: 'en-US' }),
    ).toThrow(TypeError);
  });
});

describe('formatUnit', () => {
  it('formats units with explicit decimals', () => {
    expect(formatUnit(500, getUnitMeta('mg'))).toBe('500 mg');
    expect(formatUnit(2.5, getUnitMeta('mL'))).toBe('2.5 mL');
  });

  it('fails safely on invalid unit metadata', () => {
    expect(() => getUnitMeta('kg')).toThrow(RangeError);
    expect(() => formatUnit(1, { code: 'mg', suffix: 'mg', decimals: -1 })).toThrow(
      TypeError,
    );
  });
});
