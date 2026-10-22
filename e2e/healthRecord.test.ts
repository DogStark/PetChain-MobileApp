import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

describe('Log Health Record', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { detoxSeed: 'test', detoxSkipOnboarding: 'true' },
    });
    await waitFor(element(by.id('pet-list-screen')))
      .toBeVisible()
      .withTimeout(10000);
    // Navigate to the seeded pet
    await element(by.id('pet-list-item-0')).tap();
    await waitFor(element(by.id('pet-detail-screen')))
      .toBeVisible()
      .withTimeout(5000);
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  it('opens the health records tab', async () => {
    await element(by.id('pet-detail-records-tab')).tap();
    await detoxExpect(element(by.id('health-records-list'))).toBeVisible();
  });

  it('opens the add health record form', async () => {
    await element(by.id('add-health-record-button')).tap();
    await detoxExpect(element(by.id('health-record-form'))).toBeVisible();
  });

  it('fills in and saves a health record', async () => {
    await element(by.id('record-type-selector')).tap();
    await element(by.text('Diagnosis')).tap();
    await element(by.id('record-notes-input')).typeText('Annual checkup — all clear');
    await element(by.id('record-vet-input')).typeText('Dr. Smith');
    await element(by.id('record-save-button')).tap();

    await waitFor(element(by.id('health-records-list')))
      .toBeVisible()
      .withTimeout(8000);
  });

  it('shows the new record in the list', async () => {
    await detoxExpect(element(by.text('Annual checkup — all clear'))).toBeVisible();
  });

  it('searches for the health record', async () => {
    await element(by.id('search-records-button')).tap();
    await waitFor(element(by.id('search-input')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('search-input')).typeText('Annual');
    await waitFor(element(by.text('Annual checkup — all clear')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
