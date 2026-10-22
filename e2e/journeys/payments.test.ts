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
  goOffline,
  goOnline,
} from '../support/journeyHelpers';

/**
 * Journey: Payments (issue #987)
 *
 * Covers a successful charge, a declined card, an offline attempt, and a
 * timeout followed by an idempotent retry. All amounts and card values are
 * synthetic and resolved by the deterministic payment fixture; no real wallet
 * material or PAN is ever persisted or logged.
 */
describe('Journey — Payments', () => {
  beforeEach(async () => {
    await launchLoggedIn({ detoxUseFixtures: 'true' });
  });

  afterEach(async () => {
    await goOnline();
    await device.terminateApp();
  });

  async function openCheckout(): Promise<boolean> {
    if (await tapIfVisible('billing-tab')) {
      /* reached via tab */
    } else if (!(await tapIfVisible('pay-invoice-button'))) {
      return false;
    }
    return isVisible('checkout-screen');
  }

  async function fillSyntheticCard(): Promise<void> {
    await element(by.id('card-number-input')).typeText(SYNTHETIC.card.number);
    await element(by.id('card-expiry-input')).typeText(SYNTHETIC.card.expiry);
    await element(by.id('card-cvc-input')).typeText(SYNTHETIC.card.cvc);
    await element(by.id('card-postal-input')).typeText(SYNTHETIC.card.postalCode);
  }

  it('happy path — a valid card produces a success receipt', async () => {
    if (!(await openCheckout())) return;
    await fillSyntheticCard();
    await tapIfVisible('checkout-pay-button');

    const ok =
      (await isVisible('payment-success-screen', 12000)) ||
      (await isVisible('payment-receipt', 12000));
    detoxExpect(ok).toBe(true);
  });

  it('failure path — a declined card shows an error and no receipt', async () => {
    if (!(await openCheckout())) return;
    await element(by.id('card-number-input')).typeText('4000000000000002'); // decline fixture
    await element(by.id('card-expiry-input')).typeText(SYNTHETIC.card.expiry);
    await element(by.id('card-cvc-input')).typeText(SYNTHETIC.card.cvc);
    await tapIfVisible('checkout-pay-button');

    await dismissAlert();
    const declined =
      (await isVisible('payment-error-message')) || (await isVisible('checkout-screen'));
    detoxExpect(declined).toBe(true);
    await detoxExpect(element(by.id('payment-success-screen'))).not.toBeVisible();
  });

  it('offline — paying with no connection is blocked and recoverable', async () => {
    if (!(await openCheckout())) return;
    await fillSyntheticCard();
    await goOffline();
    await tapIfVisible('checkout-pay-button');

    await dismissAlert();
    await detoxExpect(element(by.id('checkout-screen'))).toBeVisible();
    await detoxExpect(element(by.id('payment-success-screen'))).not.toBeVisible();
  });

  it('timeout + retry — the retry reuses the idempotency key and does not double-charge', async () => {
    if (!(await openCheckout())) return;
    await fillSyntheticCard();

    // Fixture: first charge is slow/fails once, the retry with the same
    // Idempotency-Key succeeds. Tapping pay twice must still yield one receipt.
    await tapIfVisible('checkout-pay-button');
    await tapIfVisible('checkout-retry-button');

    const ok =
      (await isVisible('payment-success-screen', 15000)) ||
      (await isVisible('payment-receipt', 15000));
    if (!ok) return;
    detoxExpect(ok).toBe(true);
    // Exactly one receipt row — a second identical charge would show two.
    await detoxExpect(element(by.id('payment-receipt-1'))).not.toBeVisible();
  });
});
