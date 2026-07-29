import {
  isValidEmail,
  isValidPhone,
  isValidPassword,
  validatePassword,
  isValidDate,
  isNonEmptyString,
  ERROR_MESSAGES,
} from '../validators';

describe('isValidEmail', () => {
  it.each(['user@example.com', 'a@b.co', 'user+tag@domain.org'])('valid: %s', (v) => {
    expect(isValidEmail(v)).toBe(true);
  });
  it.each(['', 'notanemail', '@no-local.com', 'no-at-sign', null, undefined])('invalid: %s', (v) =>
    expect(isValidEmail(v)).toBe(false),
  );
  it('exports an error message', () => expect(typeof ERROR_MESSAGES.email).toBe('string'));
});

describe('isValidPhone', () => {
  it.each(['+12345678', '1234567', '+447911123456'])('valid: %s', (v) => {
    expect(isValidPhone(v)).toBe(true);
  });
  it.each(['', '123', '+0123456', null, undefined])('invalid: %s', (v) => {
    expect(isValidPhone(v)).toBe(false);
  });
  it('exports an error message', () => expect(typeof ERROR_MESSAGES.phone).toBe('string'));
  it('should strip formatting characters', () => {
    expect(isValidPhone('+1 (234) 567-8901')).toBe(true);
    expect(isValidPhone('+1.234.567.8901')).toBe(true);
  });
});

describe('isValidPassword', () => {
  it.each(['Password1', 'Str0ngPass', 'ABCDEFG1h'])('valid: %s', (v) => {
    expect(isValidPassword(v)).toBe(true);
  });
  it.each(['short1A', 'nouppercase1', 'NoNumber!', '', null, undefined])('invalid: %s', (v) => {
    expect(isValidPassword(v)).toBe(false);
  });
  it('should handle special characters', () => {
    expect(isValidPassword('P@ssw0rd!')).toBe(true);
    expect(isValidPassword('Str0ng#Pass')).toBe(true);
  });
  it('exports an error message', () => expect(typeof ERROR_MESSAGES.password).toBe('string'));
});

describe('validatePassword', () => {
  it('should return isValid true for a valid password', () => {
    const result = validatePassword('Password1');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should return isValid false for a short password', () => {
    const result = validatePassword('Ab1');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.password);
  });

  it('should return isValid false for password without uppercase', () => {
    const result = validatePassword('password1');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.password);
  });

  it('should return isValid false for password without a number', () => {
    const result = validatePassword('Password');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.password);
  });

  it('should handle null and undefined', () => {
    expect(validatePassword(null).isValid).toBe(false);
    expect(validatePassword(undefined).isValid).toBe(false);
  });
});

describe('isValidDate', () => {
  it.each(['2024-01-15', '2000-12-31', 'January 1, 2020'])('valid: %s', (v) => {
    expect(isValidDate(v)).toBe(true);
  });
  it.each(['', 'not-a-date', '2024-02-30', '2024-13-01', null, undefined])('invalid: %s', (v) => {
    expect(isValidDate(v)).toBe(false);
  });
  it('exports an error message', () => expect(typeof ERROR_MESSAGES.date).toBe('string'));
});

describe('isNonEmptyString', () => {
  it.each(['hello', ' world ', 'a'])('valid: %s', (v) => {
    expect(isNonEmptyString(v)).toBe(true);
  });
  it.each(['', '   ', null, undefined, 42, false])('invalid: %s', (v) => {
    expect(isNonEmptyString(v)).toBe(false);
  });
  it('exports an error message', () => expect(typeof ERROR_MESSAGES.nonEmptyString).toBe('string'));
});
