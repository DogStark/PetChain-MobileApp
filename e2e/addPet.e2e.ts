import { device, element, by, waitFor } from 'detox';

describe('Add Pet Flow', () => {
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

  beforeEach(async () => {
    // Navigate back to pet list if needed
    await waitFor(element(by.id('add-pet-button')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('should open the add pet form when the add button is tapped', async () => {
    await element(by.id('add-pet-button')).tap();

    await waitFor(element(by.id('pet-form-name-input')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('should show a validation error when name is empty', async () => {
    await element(by.id('add-pet-button')).tap();
    await waitFor(element(by.id('pet-form-save-button')))
      .toBeVisible()
      .withTimeout(5000);

    await element(by.id('pet-form-species-input')).typeText('Dog');
    await element(by.id('pet-form-save-button')).tap();

    await waitFor(element(by.text('Name is required')))
      .toBeVisible()
      .withTimeout(3000);
  });

  it('should successfully add a new pet', async () => {
    await element(by.id('add-pet-button')).tap();
    await waitFor(element(by.id('pet-form-name-input')))
      .toBeVisible()
      .withTimeout(5000);

    await element(by.id('pet-form-name-input')).typeText('Buddy');
    await element(by.id('pet-form-species-input')).typeText('Dog');
    await element(by.id('pet-form-breed-input')).typeText('Labrador');
    await element(by.id('pet-form-save-button')).tap();

    // Should return to pet list and show the new pet
    await waitFor(element(by.text('Buddy')))
      .toBeVisible()
      .withTimeout(10000);
  });
});
