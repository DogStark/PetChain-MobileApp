// Re-export all encryption utilities
export { EncryptionError } from './types';
export {
  storeEncryptionKey,
  getEncryptionKey,
  storeSecureTokens,
  getSecureTokens,
  getSecureToken,
  getSecureRefreshToken,
  clearSecureTokens,
  getBiometricAvailability,
  isBiometricAuthenticationEnabled,
  enableBiometricAuthentication,
  authenticateWithBiometricGate,
  disableBiometricAuthentication,
} from './keychain';
export { encrypt, decrypt, hashPassword, deriveKey } from './crypto';
