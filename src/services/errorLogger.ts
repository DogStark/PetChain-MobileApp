import apiClient, { resilientRequest } from './apiClient';
import crashReporting from './crashReporting';

async function sendToServer(payload: Record<string, unknown>) {
  try {
    await resilientRequest({ url: '/errors', method: 'POST', data: payload });
  } catch {
    // fallback to apiClient.post if resilientRequest unavailable
    try {
      await apiClient.post('/errors', payload);
    } catch {
      // swallow — logging best-effort
    }
  }
}

async function logError(err: unknown, meta: string | Record<string, unknown> = ''): Promise<void> {
  try {
    const payload = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      meta,
      timestamp: Date.now(),
    };
    // console log locally for developer visibility

    console.error('[ErrorLogger]', payload);
    // Forward to Sentry for crash dashboard visibility
    crashReporting.captureException(err instanceof Error ? err : new Error(String(err)), {
      meta: typeof meta === 'string' ? { info: meta } : meta,
    });
    await sendToServer(payload);
  } catch {
    // final fallback — do nothing
  }
}

export default { logError };
