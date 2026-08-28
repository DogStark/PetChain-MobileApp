import { decimalToUnits, unitsToDecimal } from '../../utils/decimal';

describe('payment precision characterization', () => {
  it('shows JavaScript floating-point cents conversion can lose a cent', () => {
    expect(Math.round(1.255 * 100)).toBe(125);
  });

  it('converts decimal currency to exact integer units', () => {
    expect(() => decimalToUnits('1.255', 2)).toThrow(
      'Decimal amount has too many fractional digits',
    );
  });

  it('preserves seven-decimal Stellar amounts without floating-point rounding', () => {
    const stroops = decimalToUnits('9.9400500', 7);

    expect(stroops).toBe(99400500n);
    expect(unitsToDecimal(stroops, 7)).toBe('9.94005');
  });

  it('rejects malformed, negative, and over-precise amounts', () => {
    expect(() => decimalToUnits('1.2x', 2)).toThrow('Invalid decimal amount');
    expect(() => decimalToUnits('-1', 2)).toThrow('Invalid decimal amount');
    expect(() => decimalToUnits('1.001', 2)).toThrow(
      'Decimal amount has too many fractional digits',
    );
  });
});