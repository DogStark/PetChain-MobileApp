const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export function decimalToUnits(value: string, scale: number): bigint {
  const normalized = value.trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new Error('Invalid decimal amount');

  const fraction = match[2] ?? '';
  if (fraction.length > scale) throw new Error('Decimal amount has too many fractional digits');

  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
}

export function unitsToDecimal(units: bigint, scale: number): string {
  if (units < 0n) throw new Error('Decimal amount cannot be negative');
  const factor = 10n ** BigInt(scale);
  const whole = units / factor;
  const fraction = (units % factor).toString().padStart(scale, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function compareDecimal(a: string, b: string, scale: number): number {
  const left = decimalToUnits(a, scale);
  const right = decimalToUnits(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function multiplyDecimalByRatio(
  value: string,
  numerator: bigint,
  denominator: bigint,
  scale: number,
): string {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid decimal ratio');
  const units = decimalToUnits(value, scale);
  return unitsToDecimal((units * numerator) / denominator, scale).padEnd(scale + 2, '0');
}

export function decimalRatio(numerator: string, denominator: string, scale: number): string {
  const numeratorUnits = decimalToUnits(numerator, scale);
  const denominatorUnits = decimalToUnits(denominator, scale);
  if (denominatorUnits === 0n) throw new Error('Cannot divide by zero');

  const factor = 10n ** BigInt(scale);
  const scaled = (numeratorUnits * factor) / denominatorUnits;
  return unitsToDecimal(scaled, scale).padEnd(scale + 2, '0');
}

export function canonicalDecimal(value: string, scale: number): string {
  return unitsToDecimal(decimalToUnits(value, scale), scale).padEnd(scale + 2, '0');
}