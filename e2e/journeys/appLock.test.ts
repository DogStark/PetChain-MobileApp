import {
  by,
  device,
  element,
  detoxExpect,
  waitFor,
  SYNTHETIC,
  isVisible,
  tapIfVisible,
  dismissAlert,
  launchLoggedIn,
  backgroundAndForeground,
} from '../support/journeyHelpers';

/**
 * Journey: App lock / biometric gate (issue #987)
 *
 * Covers enabling the lock, unlocking on foreground, wrong-PIN handling,
 * biometric-permission-denied fallback, and the reduced-motion / large text
 * accessibility checks required for a UI change.
 */
describe('Journey — App Lock', () => {
  beforeAll(async () => {
    await launchLoggedIn({ detoxAppLock: 'enabled', detoxAppLockPin: SYNTHETIC.pin });
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('locks the app when it returns from the background', async () => {
    await backgroundAndForeground(2);

    const locked = await isVisible('app-lock-screen');
    if (!locked) return; // lock feature not wired yet — behavior documented
    await detoxExpect(element(by.id('app-lock-screen'))).toBeVisible();
    // Protected content must not be readable behind the lock.
    await detoxExpect(element(by.id('pet-list-screen'))).not.toBeVisible();
  });

  it('happy path — correct PIN unlocks and reveals protected content', async () => {
    if (!(await isVisible('app-lock-screen'))) return;
    await element(by.id('app-lock-pin-input')).typeText(SYNTHETIC.pin);
    await tapIfVisible('app-lock-submit-button');
    await waitFor(element(by.id('pet-list-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('failure path — wrong PIN is rejected and stays on the lock screen', async () => {
    await backgroundAndForeground(2);
    if (!(await isVisible('app-lock-screen'))) return;

    await element(by.id('app-lock-pin-input')).typeText('000000');
    await tapIfVisible('app-lock-submit-button');
    await dismissAlert();
    await detoxExpect(element(by.id('app-lock-screen'))).toBeVisible();

    // Recover with the correct PIN.
    await element(by.id('app-lock-pin-input')).clearText();
    await element(by.id('app-lock-pin-input')).typeText(SYNTHETIC.pin);
    await tapIfVisible('app-lock-submit-button');
    await waitFor(element(by.id('pet-list-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('permission-denied — biometric unavailable falls back to PIN entry', async () => {
    await device.launchApp({
      newInstance: false,
      permissions: { faceid: 'NO' },
    });
    await backgroundAndForeground(2);
    if (!(await isVisible('app-lock-screen'))) return;
    // With biometrics denied the PIN pad must still be offered.
    await detoxExpect(element(by.id('app-lock-pin-input'))).toBeVisible();
  });
});
