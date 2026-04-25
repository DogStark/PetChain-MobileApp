import { device, element, by, expect, waitFor } from 'detox';

describe('View Medical Record Flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });

    // Log in first
    await waitFor(element(by.id('login-email-input')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('login-email-input')).typeText('test@petchain.app');
    await element(by.id('login-password-input')).typeText('Password123!');
    await element(by.id('login-submit-button')).tap();

    await waitFor(element(by.id('add-pet-button')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should display the pet list after login', async () => {
    await expect(element(by.id('add-pet-button'))).toBeVisible();
  });

  it('should navigate to pet detail when a pet is tapped', async () => {
    // Tap the first pet card in the list
    await waitFor(element(by.id(/^pet-item-/)).atIndex(0))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id(/^pet-item-/))
      .atIndex(0)
      .tap();

    // Pet detail screen should show a back button or pet name
    await waitFor(element(by.text('Pet Details')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('should navigate to the Medications tab', async () => {
    await element(by.text('Medications')).tap();
    await waitFor(element(by.text('Medications')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
