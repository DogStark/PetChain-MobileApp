/**
 * Deterministic backend fixtures for the safety-critical Detox journeys
 * (issue #987). These describe the canned responses the app should serve when
 * launched with `detoxUseFixtures=true`, so the auth / lock / QR / offline /
 * payment journeys are hermetic and identical on iOS and Android.
 *
 * SYNTHETIC DATA ONLY — no real people, tokens, wallets or medical records.
 * The `token` values below are obviously-fake opaque strings and must never be
 * printed to logs, analytics, screenshots or crash reports.
 */

export type FixtureRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Matched against the request path (substring or RegExp source). */
  path: string;
  /** HTTP status to return. */
  status: number;
  /** JSON body to return. */
  body: unknown;
  /**
   * When set, the fixture fails this many times before succeeding — used to
   * exercise retry / idempotency paths deterministically.
   */
  failTimes?: number;
  /** Artificial delay (ms) to exercise timeout / cancellation paths. */
  delayMs?: number;
};

export const authFixtures: FixtureRoute[] = [
  {
    method: 'POST',
    path: '/auth/login',
    status: 200,
    body: {
      token: 'fixture-access-token-DO-NOT-LOG',
      refreshToken: 'fixture-refresh-token-DO-NOT-LOG',
      user: { id: 'user_fixture_0001', name: 'Journey User', email: 'journey-user@petchain.test' },
    },
  },
  {
    method: 'POST',
    path: '/auth/login/invalid',
    status: 401,
    body: { error: 'invalid_credentials', message: 'Email or password is incorrect.' },
  },
  {
    method: 'POST',
    path: '/auth/refresh',
    status: 200,
    body: { token: 'fixture-access-token-2-DO-NOT-LOG' },
  },
];

export const qrFixtures: FixtureRoute[] = [
  {
    method: 'GET',
    path: '/pets/resolve?code=pet_fixture_0001',
    status: 200,
    body: { id: 'pet_fixture_0001', name: 'Sparky', species: 'dog', ownerId: 'user_fixture_0001' },
  },
  {
    method: 'GET',
    path: '/pets/resolve?code=unknown',
    status: 404,
    body: { error: 'not_found', message: 'No pet matches this code.' },
  },
];

export const paymentFixtures: FixtureRoute[] = [
  {
    // First attempt times out, retry with the same Idempotency-Key succeeds.
    method: 'POST',
    path: '/payments/charge',
    status: 200,
    failTimes: 1,
    delayMs: 500,
    body: {
      id: 'pay_fixture_0001',
      status: 'succeeded',
      amount: 2500,
      currency: 'usd',
      idempotent: true,
    },
  },
  {
    method: 'POST',
    path: '/payments/charge/declined',
    status: 402,
    body: { error: 'card_declined', message: 'Your card was declined.' },
  },
];

export const offlineQueueFixtures: FixtureRoute[] = [
  {
    // Queued mutation replayed on reconnect — must be idempotent server-side.
    method: 'POST',
    path: '/pets/pet_fixture_0001/health-records',
    status: 201,
    body: { id: 'rec_fixture_0001', queuedReplay: true },
  },
];

export const allFixtures: FixtureRoute[] = [
  ...authFixtures,
  ...qrFixtures,
  ...paymentFixtures,
  ...offlineQueueFixtures,
];
