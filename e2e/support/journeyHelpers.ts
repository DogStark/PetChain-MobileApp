import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

/**
 * Shared helpers for the safety-critical Detox journeys added in issue #987
 * (auth, app lock, QR, offline queue, payments).
 *
 * Everything here uses deterministic, synthetic data only. No real tokens,
 * health records, contact details, wallet material or precise location values
 * are ever typed, logged or persisted by these helpers.
 */

export const SYNTHETIC = {
  email: 'journey-user@petchain.test',
  password: 'JourneyPass123!',
  name: 'Journey User',
  // 6-digit app-lock PIN — synthetic, not a real secret.
  pin: '246810',
  // Fake QR payload; the backend fixture resolves this to a seeded pet.
  petQrPayload: 'petchain://pet/pet_fixture_0001',
  malformedQrPayload: 'not-a-petchain-uri',
  // Synthetic card accepted by the deterministic payment fixture.
  card: {
    number: '4242424242424242',
    expiry: '12/34',
    cvc: '123',
    postalCode: '90210',
  },
} as const;

/** Common launch args that pin the backend to deterministic fixtures. */
export function fixtureLaunchArgs(extra: Record<string, string> = {}) {
  return {
    detoxSeed: 'test',
    // Route all network calls at the in-app mock backend fixtures so the
    // journeys are hermetic and reproducible across iOS and Android.
    detoxUseFixtures: 'true',
    ...extra,
  };
}

/** Launch (or relaunch) the app already past onboarding, on the pet list. */
export async function launchLoggedIn(extra: Record<string, string> = {}): Promise<void> {
  await device.launchApp({
    newInstance: true,
    launchArgs: fixtureLaunchArgs({ detoxSkipOnboarding: 'true', ...extra }),
  });
  await waitFor(element(by.id('pet-list-screen')))
    .toBeVisible()
    .withTimeout(15000);
}

/**
 * Best-effort visibility probe. Several of these journeys exercise flows whose
 * testIDs may not exist yet — this lets a spec *characterize* current behavior
 * (per the acceptance criteria) without failing the whole suite when a screen
 * is not yet wired up. Mirrors the existing pattern in `onboarding.test.ts`.
 */
export async function isVisible(testId: string, timeout = 4000): Promise<boolean> {
  try {
    await waitFor(element(by.id(testId)))
      .toBeVisible()
      .withTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

/** Tap an element only if it is currently on screen; returns whether it tapped. */
export async function tapIfVisible(testId: string, timeout = 4000): Promise<boolean> {
  if (await isVisible(testId, timeout)) {
    await element(by.id(testId)).tap();
    return true;
  }
  return false;
}

/** Dismiss a native alert by its OK/allow button if one is showing. */
export async function dismissAlert(): Promise<void> {
  for (const label of ['OK', 'Ok', 'Dismiss', 'Got it']) {
    try {
      await waitFor(element(by.text(label)))
        .toBeVisible()
        .withTimeout(1500);
      await element(by.text(label)).tap();
      return;
    } catch {
      // try the next label
    }
  }
}

/** Simulate going offline by black-listing every outbound request. */
export async function goOffline(): Promise<void> {
  await device.setURLBlacklist(['.*']);
}

/** Restore connectivity. */
export async function goOnline(): Promise<void> {
  await device.setURLBlacklist([]);
}

/** Send the app to the background then foreground it again. */
export async function backgroundAndForeground(seconds = 2): Promise<void> {
  await device.sendToHome();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  await device.launchApp({ newInstance: false });
}

export { by, device, element, detoxExpect, waitFor };
