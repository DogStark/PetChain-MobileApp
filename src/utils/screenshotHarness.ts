/**
 * Privacy-safe screenshot harness — Issue #1210
 *
 * Deterministic fixtures for the pet, medical, wallet and location screens,
 * plus a masking helper. Sensitive values are masked by default; a value is
 * only shown when the server has confirmed the viewer may see it, so captured
 * screenshots never leak real pet or owner data.
 */

// ─── Permissions ──────────────────────────────────────────────────────────────

/**
 * Permissions as confirmed by the server. Anything other than an explicit
 * `true` (including a missing or stale snapshot) is treated as "not allowed".
 */
export interface ScreenshotPermissions {
  canViewSensitive?: boolean | null;
}

export const MASKED_VALUE = '••••';
export const MASKED_ACCESSIBILITY_LABEL = 'Hidden';

/**
 * Returns the value only when the server has confirmed visibility, otherwise a
 * fixed mask. The mask is fixed-length so its size reveals nothing about the
 * underlying value.
 */
export function maskSensitiveValue(value: string, permissions?: ScreenshotPermissions): string {
  return permissions?.canViewSensitive === true ? value : MASKED_VALUE;
}

/**
 * Text and accessibility label for a sensitive field. Screen readers announce
 * "Hidden" rather than the mask glyphs, so accessibility settings still work.
 */
export function describeSensitiveValue(
  value: string,
  permissions?: ScreenshotPermissions,
): { text: string; accessibilityLabel: string } {
  if (permissions?.canViewSensitive === true) {
    return { text: value, accessibilityLabel: value };
  }
  return { text: MASKED_VALUE, accessibilityLabel: MASKED_ACCESSIBILITY_LABEL };
}

// ─── Deterministic fixtures ───────────────────────────────────────────────────

/** Fixed clock so screenshots never change between runs. */
export const SCREENSHOT_FIXTURE_TIMESTAMP = '2024-01-01T00:00:00.000Z';

export interface ScreenshotPetFixture {
  id: string;
  name: string;
  species: string;
  breed: string;
  dateOfBirth: string;
}

export interface ScreenshotMedicalFixture {
  id: string;
  petId: string;
  recordType: string;
  date: string;
  diagnosis: string;
  notes: string;
}

export interface ScreenshotWalletFixture {
  id: string;
  currency: string;
  balance: string;
  address: string;
}

export interface ScreenshotLocationFixture {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  address: string;
}

export interface ScreenshotFixtures {
  pet: ScreenshotPetFixture;
  medicalRecord: ScreenshotMedicalFixture;
  wallet: ScreenshotWalletFixture;
  location: ScreenshotLocationFixture;
}

/**
 * Builds the same fixture set on every call. Uses reserved example values
 * (example.com, 555 numbers, placeholder addresses) so no real data appears.
 */
export function buildScreenshotFixtures(): ScreenshotFixtures {
  return {
    pet: {
      id: 'screenshot-pet-001',
      name: 'Example Pet',
      species: 'dog',
      breed: 'Mixed Breed',
      dateOfBirth: '2020-01-01',
    },
    medicalRecord: {
      id: 'screenshot-record-001',
      petId: 'screenshot-pet-001',
      recordType: 'checkup',
      date: SCREENSHOT_FIXTURE_TIMESTAMP,
      diagnosis: 'Healthy',
      notes: 'Example wellness exam. All values within range.',
    },
    wallet: {
      id: 'screenshot-wallet-001',
      currency: 'USD',
      balance: '0.00',
      address: 'EXAMPLE-WALLET-ADDRESS',
    },
    location: {
      id: 'screenshot-location-001',
      label: 'Example Clinic',
      latitude: 0,
      longitude: 0,
      address: '123 Example Street',
    },
  };
}
