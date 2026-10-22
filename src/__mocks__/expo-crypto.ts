/**
 * Mock for expo-crypto — lightweight stub for Jest tests.
 */
export const randomUUID = jest.fn(() => '00000000-0000-4000-8000-000000000000');
export const getRandomBytes = jest.fn((size: number) => Buffer.alloc(size));
export const getRandomBytesAsync = jest.fn(async (size: number) => Buffer.alloc(size));
export const digestStringAsync = jest.fn(async () => 'mocked-digest');
export const digest = jest.fn(() => 'mocked-digest');
export const CryptoDigestAlgorithm = { SHA256: 'SHA256' };
