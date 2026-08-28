import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

describe('Add Pet', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxSeed: 'test', detoxSkipOnboarding: 'true' },
    });
    // Wait for pet list to be ready
    await waitFor(element(by.id('pet-list-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('opens the add pet form', async () => {
    await element(by.id('add-pet-button')).tap();
    await detoxExpect(element(by.id('pet-form-screen'))).toBeVisible();
  });

  it('fills in pet details and saves', async () => {
    await element(by.id('pet-name-input')).typeText('Buddy');
    await element(by.id('pet-species-input')).typeText('Dog');
    await element(by.id('pet-breed-input')).typeText('Labrador');
    await element(by.id('pet-dob-input')).typeText('2020-01-15');
    await element(by.id('pet-form-save-button')).tap();

    await waitFor(element(by.id('pet-list-screen')))
      .toBeVisible()
      .withTimeout(8000);
  });

  it('shows the new pet in the list', async () => {
    await detoxExpect(element(by.text('Buddy'))).toBeVisible();
  });

  it('navigates to pet detail screen', async () => {
    await element(by.text('Buddy')).tap();
    await detoxExpect(element(by.id('pet-detail-screen'))).toBeVisible();
  });
});
