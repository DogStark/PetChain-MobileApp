import jwt from 'jsonwebtoken';

import { UserRole } from '../backend/models/UserRole';

const TEST_SECRET = 'test-secret-key';

/**
 * Generate a test JWT token
 */
export function generateTestToken(
  userId: string,
  role: UserRole = UserRole.OWNER,
  overrides: Record<string, any> = {},
): string {
  return jwt.sign(
    {
      sub: userId,
      email: `${userId}@test.com`,
      role,
      ...overrides,
    },
    TEST_SECRET,
  );
}

/**
 * Create a mock user object
 */
export function createMockUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-123',
    email: 'test@test.com',
    name: 'Test User',
    role: UserRole.OWNER,
    pets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isEmailVerified: true,
    ...overrides,
  };
}

/**
 * Create a mock pet object
 */
export function createMockPet(overrides: Record<string, any> = {}) {
  return {
    id: 'pet-123',
    ownerId: 'user-123',
    name: 'Fluffy',
    species: 'cat',
    breed: 'Persian',
    dateOfBirth: '2020-01-01',
    microchipId: 'chip-123',
    photoUrl: 'https://example.com/pet.jpg',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock medical record
 */
export function createMockMedicalRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'record-123',
    petId: 'pet-123',
    ownerId: 'user-123',
    vetId: 'vet-123',
    type: 'checkup',
    visitDate: new Date().toISOString(),
    diagnosis: 'Healthy',
    treatment: 'Routine checkup',
    notes: 'All good',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock appointment
 */
export function createMockAppointment(overrides: Record<string, any> = {}) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);

  return {
    id: 'appointment-123',
    petId: 'pet-123',
    ownerId: 'user-123',
    vetId: 'vet-123',
    scheduledAt: futureDate.toISOString(),
    reason: 'Checkup',
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock medication
 */
export function createMockMedication(overrides: Record<string, any> = {}) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 10);

  return {
    id: 'medication-123',
    petId: 'pet-123',
    name: 'Amoxicillin',
    dosage: '500mg',
    frequency: 'twice daily',
    startDate: new Date().toISOString(),
    endDate: endDate.toISOString(),
    prescribedBy: 'vet-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock payment
 */
export function createMockPayment(overrides: Record<string, any> = {}) {
  return {
    id: 'payment-123',
    userId: 'user-123',
    amount: 9.99,
    currency: 'USD',
    status: 'completed',
    provider: 'stripe',
    providerTransactionId: 'txn_123',
    plan: 'premium_monthly',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock insurance policy
 */
export function createMockInsurancePolicy(overrides: Record<string, any> = {}) {
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  return {
    id: 'policy-123',
    userId: 'user-123',
    provider: 'trupanion',
    policyNumber: 'POL-123456',
    petId: 'pet-123',
    coverageLimit: 10000,
    deductible: 250,
    premium: 49.99,
    status: 'active',
    expiresAt: expiresAt.toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock insurance claim
 */
export function createMockInsuranceClaim(overrides: Record<string, any> = {}) {
  return {
    id: 'claim-123',
    policyId: 'policy-123',
    userId: 'user-123',
    petId: 'pet-123',
    amount: 500,
    description: 'Veterinary treatment',
    status: 'submitted',
    attachmentUrls: [],
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock message
 */
export function createMockMessage(overrides: Record<string, any> = {}) {
  return {
    id: 'message-123',
    conversationId: 'user-1:user-2',
    senderId: 'user-1',
    recipientId: 'user-2',
    content: 'Hello',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Wait for async operations
 */
export function waitFor(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock API response
 */
export function mockApiResponse<T>(data: T, status: number = 200) {
  return {
    status,
    data,
    headers: {},
  };
}

/**
 * Mock API error
 */
export function mockApiError(message: string, status: number = 500) {
  const error = new Error(message);
  (error as any).response = {
    status,
    data: { error: { message } },
  };
  return error;
}

/**
 * Reset all mocks
 */
export function resetAllMocks() {
  jest.clearAllMocks();
  jest.clearAllTimers();
}

/**
 * Setup test environment
 */
export function setupTestEnvironment() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.STELLAR_NETWORK = 'testnet';
  jest.useFakeTimers();
}

/**
 * Cleanup test environment
 */
export function cleanupTestEnvironment() {
  jest.useRealTimers();
  jest.clearAllMocks();
}
