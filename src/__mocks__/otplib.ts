export const authenticator = {
  generateSecret: () => 'MOCK_SECRET',
  keyuri: () => 'otpauth://totp/mock',
  verify: () => true,
};
