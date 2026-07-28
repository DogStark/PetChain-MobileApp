import {
  isValidEmail,
  isValidPhone,
  isValidDate,
  validatePetAge,
  validateDosage,
  VALIDATION_ERRORS,
  type ValidationResult,
} from '../validators';

// ─── isValidEmail ─────────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  it.each(['user@example.com', 'a@b.co', 'user+tag@domain.org', 'name.surname@host.co.uk'])(
    'valid: %s',
    (v) => {
      const result: ValidationResult = isValidEmail(v);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    },
  );

  it.each(['', 'notanemail', '@no-local.com', 'no-at-sign', null, undefined])(
    'invalid: %s',
    (v) => {
      const result = isValidEmail(v);
      expect(result.isValid).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error!.length).toBeGreaterThan(0);
    },
  );

  it('rejects emails longer than 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@b.co';
    expect(isValidEmail(longEmail).isValid).toBe(false);
  });

  it('exports VALIDATION_ERRORS.email as a string', () => {
    expect(typeof VALIDATION_ERRORS.email).toBe('string');
  });
});

// ─── isValidPhone ─────────────────────────────────────────────────────────────

describe('isValidPhone', () => {
  it.each(['+12345678', '1234567', '+447911123456', '12 345 678', '+1 (800) 555-1234'])(
    'valid: %s',
    (v) => {
      const result = isValidPhone(v);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    },
  );

  it.each(['', '123', '+0123456', null, undefined])('invalid: %s', (v) => {
    const result = isValidPhone(v);
    expect(result.isValid).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('exports VALIDATION_ERRORS.phone as a string', () => {
    expect(typeof VALIDATION_ERRORS.phone).toBe('string');
  });
});

// ─── isValidDate ─────────────────────────────────────────────────────────────

describe('isValidDate', () => {
  it.each(['2024-01-15', '2000-12-31', '2025-06-30', 'January 1, 2020'])('valid: %s', (v) => {
    const result = isValidDate(v);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
  });

  it.each(['', 'not-a-date', '2024-02-30', '2024-13-01', null, undefined])('invalid: %s', (v) => {
    const result = isValidDate(v);
    expect(result.isValid).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('exports VALIDATION_ERRORS.date as a string', () => {
    expect(typeof VALIDATION_ERRORS.date).toBe('string');
  });
});

// ─── validatePetAge ───────────────────────────────────────────────────────────

describe('validatePetAge', () => {
  it.each([0, 0.5, 1, 5, 15, 50])('valid age: %s', (age) => {
    const result = validatePetAge(age);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
  });

  it.each([-1, -0.1])('rejects negative age: %s', (age) => {
    const result = validatePetAge(age);
    expect(result.isValid).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it.each([51, 100, 999])('rejects age > 50: %s', (age) => {
    const result = validatePetAge(age);
    expect(result.isValid).toBe(false);
  });

  it.each([null, undefined, '', 'abc'])('rejects non-numeric: %s', (age) => {
    const result = validatePetAge(age);
    expect(result.isValid).toBe(false);
  });

  it('accepts numeric strings', () => {
    expect(validatePetAge('3').isValid).toBe(true);
  });

  it('exports VALIDATION_ERRORS.petAge as a string', () => {
    expect(typeof VALIDATION_ERRORS.petAge).toBe('string');
  });
});

// ─── validateDosage ───────────────────────────────────────────────────────────

describe('validateDosage', () => {
  it.each(['5mg', '2.5 ml', '100mcg', '0.1 g', '10000'])('valid dosage: %s', (dosage) => {
    const result = validateDosage(dosage);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('accepts a plain positive number', () => {
    expect(validateDosage(5).isValid).toBe(true);
  });

  it.each(['', null, undefined])('rejects empty/null: %s', (dosage) => {
    const result = validateDosage(dosage);
    expect(result.isValid).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('rejects zero dosage', () => {
    expect(validateDosage('0').isValid).toBe(false);
  });

  it('rejects negative dosage', () => {
    expect(validateDosage('-5mg').isValid).toBe(false);
  });

  it('rejects dosage above 10 000', () => {
    expect(validateDosage('10001mg').isValid).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(validateDosage('abc').isValid).toBe(false);
  });

  it('exports VALIDATION_ERRORS.dosage as a string', () => {
    expect(typeof VALIDATION_ERRORS.dosage).toBe('string');
  });
});

// ─── ValidationResult shape ───────────────────────────────────────────────────

describe('ValidationResult type contract', () => {
  it('valid result has isValid=true and error=null', () => {
    const r = isValidEmail('user@example.com');
    expect(r).toEqual({ isValid: true, error: null });
  });

  it('invalid result has isValid=false and a non-null error string', () => {
    const r = isValidEmail('bad');
    expect(r.isValid).toBe(false);
    expect(r.error).not.toBeNull();
    expect(typeof r.error).toBe('string');
  });
});
