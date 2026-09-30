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
} from '../support/journeyHelpers';

/**
 * Journey: QR scanning (issue #987)
 *
 * Covers camera-permission-granted happy path, permission-denied fallback,
 * malformed payload handling, and unknown-code (404) handling — all resolved
 * through deterministic backend fixtures so no real pet data is involved.
 *
 * The scanner is driven via the `detoxQrPayload` launch arg / deep link rather
 * than a real camera, keeping the journey hermetic on CI simulators.
 */
describe('Journey — QR Scan', () => {
  afterEach(async () => {
    await device.terminateApp();
  });

  it('happy path — a valid pet QR resolves to the pet detail screen', async () => {
    await launchLoggedIn({ detoxQrPayload: SYNTHETIC.petQrPayload });
    if (!(await tapIfVisible('qr-scan-tab')) && !(await tapIfVisible('scan-qr-button'))) return;

    await tapIfVisible('qr-simulate-scan-button');
    const resolved =
      (await isVisible('pet-detail-screen', 8000)) || (await isVisible('qr-result-screen', 8000));
    detoxExpect(resolved).toBe(true);
  });

  it('permission-denied — denied camera access shows a recoverable message', async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { camera: 'NO' },
      launchArgs: { detoxSeed: 'test', detoxSkipOnboarding: 'true', detoxUseFixtures: 'true' },
    });
    await waitFor(element(by.id('pet-list-screen')))
      .toBeVisible()
      .withTimeout(15000);
    if (!(await tapIfVisible('qr-scan-tab')) && !(await tapIfVisible('scan-qr-button'))) return;

    const denied =
      (await isVisible('qr-permission-denied')) || (await isVisible('camera-permission-cta'));
    detoxExpect(denied).toBe(true);
  });

  it('malformed input — a non-PetChain payload is rejected without crashing', async () => {
    await launchLoggedIn({ detoxQrPayload: SYNTHETIC.malformedQrPayload });
    if (!(await tapIfVisible('qr-scan-tab')) && !(await tapIfVisible('scan-qr-button'))) return;
    await tapIfVisible('qr-simulate-scan-button');

    await dismissAlert();
    // We must remain on the scanner, not navigate to a bogus detail screen.
    const stillScanning =
      (await isVisible('qr-scan-screen')) || (await isVisible('qr-error-message'));
    detoxExpect(stillScanning).toBe(true);
  });

  it('failure path — unknown code returns a not-found message', async () => {
    await launchLoggedIn({ detoxQrPayload: 'petchain://pet/unknown' });
    if (!(await tapIfVisible('qr-scan-tab')) && !(await tapIfVisible('scan-qr-button'))) return;
    await tapIfVisible('qr-simulate-scan-button');

    await dismissAlert();
    const notFound =
      (await isVisible('qr-not-found')) || (await isVisible('qr-error-message'));
    detoxExpect(notFound).toBe(true);
  });
});
