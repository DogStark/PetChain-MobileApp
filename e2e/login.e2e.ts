import { device, element, by, waitFor } from 'detox';

describe('Login Flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should show the login screen on launch', async () => {
    await waitFor(element(by.id('login-email-input')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('should show a validation error when fields are empty', async () => {
    await element(by.id('login-submit-button')).tap();
    await waitFor(element(by.text('Email and password are required.')))
      .toBeVisible()
      .withTimeout(3000);
  });

  it('should log in successfully with valid credentials', async () => {
    await element(by.id('login-email-input')).typeText('test@petchain.app');
    await element(by.id('login-password-input')).typeText('Password123!');
    await element(by.id('login-submit-button')).tap();

    // After login, the pet list screen should appear
    await waitFor(element(by.id('add-pet-button')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should show an error for invalid credentials', async () => {
    await element(by.id('login-email-input')).typeText('wrong@example.com');
    await element(by.id('login-password-input')).typeText('wrongpassword');
    await element(by.id('login-submit-button')).tap();

    await waitFor(element(by.text('Login Failed')))
      .toBeVisible()
      .withTimeout(10000);
  });
});
