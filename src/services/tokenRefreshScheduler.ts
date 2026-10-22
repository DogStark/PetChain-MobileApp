/**
 * Token Refresh Scheduler
 *
 * Responsible for triggering a token refresh when a session is extended.
 * Decoupled from session lifecycle so it can be tested in isolation.
 */

/**
 * Attempt to refresh the auth token by dynamically importing authService.
 * Non-fatal: refresh failures are swallowed so the caller's session
 * extension logic is not disrupted.
 */
export async function scheduleTokenRefresh(): Promise<void> {
  try {
    const { refreshToken } = await import('./authService');
    await refreshToken();
  } catch {
    // Non-fatal — session extension failure must not crash the app.
  }
}
