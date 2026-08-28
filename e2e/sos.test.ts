import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

describe('Emergency SOS Flow', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxSeed: 'test', detoxSkipOnboarding: 'true' },
    });
    await waitFor(element(by.id('pet-list-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('navigates to emergency contacts screen', async () => {
    await element(by.id('emergency-tab')).tap();
    await detoxExpect(element(by.id('emergency-contacts-screen'))).toBeVisible();
  });

  it('shows the SOS button', async () => {
    await detoxExpect(element(by.id('sos-button'))).toBeVisible();
  });

  it('shows confirmation dialog before triggering SOS', async () => {
    await element(by.id('sos-button')).tap();
    await detoxExpect(element(by.id('sos-confirm-dialog'))).toBeVisible();
  });

  it('can cancel the SOS confirmation', async () => {
    await element(by.id('sos-cancel-button')).tap();
    await detoxExpect(element(by.id('sos-confirm-dialog'))).not.toBeVisible();
    await detoxExpect(element(by.id('emergency-contacts-screen'))).toBeVisible();
  });

  it('can add an emergency contact', async () => {
    await element(by.id('add-emergency-contact-button')).tap();
    await detoxExpect(element(by.id('emergency-contact-form'))).toBeVisible();
    await element(by.id('contact-name-input')).typeText('Jane Doe');
    await element(by.id('contact-phone-input')).typeText('+15551234567');
    await element(by.id('contact-save-button')).tap();
    await waitFor(element(by.text('Jane Doe')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
