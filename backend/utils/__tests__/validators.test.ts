import {
  validateEmail,
  validatePhoneNumber,
  validatePassword,
  validateDate,
  validateField,
} from '../validators';

describe('backend validators', () => {
  describe('validateEmail', () => {
    it('should validate correct email', () => {
      expect(validateEmail('test@example.com').isValid).toBe(true);
    });

    it('should reject empty email', () => {
      expect(validateEmail('').isValid).toBe(false);
      expect(validateEmail('').error).toBe('Email is required.');
    });

    it('should reject invalid format', () => {
      expect(validateEmail('invalid-email').isValid).toBe(false);
    });
  });

  describe('validatePhoneNumber', () => {
    it('should validate correct phone number', () => {
      expect(validatePhoneNumber('+1234567890').isValid).toBe(true);
      expect(validatePhoneNumber('1234567890').isValid).toBe(true);
    });

    it('should reject invalid phone number', () => {
      expect(validatePhoneNumber('123').isValid).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('should validate strong password', () => {
      expect(validatePassword('Password123!').isValid).toBe(true);
    });

    it('should reject short password', () => {
      expect(validatePassword('Short1!').isValid).toBe(false);
    });
  });

  describe('validateDate', () => {
    it('should validate correct date', () => {
      expect(validateDate('2023-01-01').isValid).toBe(true);
    });

    it('should reject impossible date', () => {
      expect(validateDate('2023-02-30').isValid).toBe(false);
    });

    it('should respect future/past constraints', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      expect(validateDate(tomorrow, { allowFuture: false }).isValid).toBe(false);
      expect(validateDate(yesterday, { allowPast: false }).isValid).toBe(false);
    });
  });

  describe('validateField', () => {
    it('should validate generic field', () => {
      expect(validateField('test', { required: true, minLength: 3 }).isValid).toBe(true);
      expect(validateField('te', { minLength: 3 }).isValid).toBe(false);
    });
  });
});
