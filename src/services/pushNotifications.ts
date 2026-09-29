import { Platform } from 'react-native';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { apiClient } from './apiClient';
import { storage } from './storage';

const PUSH_TOKEN_KEY = 'push_token';
const PUSH_TOKEN_OWNER_KEY = 'push_token_owner';

let currentToken: string | null = null;
let currentOwner: string | null = null;
let registering = false;

/**
 * Push-token lifecycle management.
 *
 * Tokens are registered with the backend when obtained, rotated when the OS
 * issues a new APNs/FCM token, and invalidated/deleted on logout or account
 * deletion. Server responses indicating an invalid/unregistered token trigger
 * local cleanup without retry storms.
 */

async function persistToken(token: string, owner: string | null): Promise<void> {
  currentToken = token;
  currentOwner = owner;
  await storage.setItem(PUSH_TOKEN_KEY, token);
  if (owner) {
    await storage.setItem(PUSH_TOKEN_OWNER_KEY, owner);
  } else {
    await storage.removeItem(PUSH_TOKEN_OWNER_KEY);
  }
}

async function clearPersistedToken(): Promise<void> {
  currentToken = null;
  currentOwner = null;
  await storage.removeItem(PUSH_TOKEN_KEY);
  await storage.removeItem(PUSH_TOKEN_OWNER_KEY);
}

/**
 * Register the current device token with the backend. Idempotent: the same
 * token is never registered twice for the same owner.
 */
export async function registerPushToken(owner: string): Promise<void> {
  if (registering) {
    return;
  }
  registering = true;
  try {
    const token = await messaging().getToken();
    if (!token) {
      return;
    }
    if (token === currentToken && owner === currentOwner) {
      return;
    }
    await apiClient.post('/push/tokens', {
      token,
      platform: Platform.OS,
      owner,
    });
    await persistToken(token, owner);
  } catch (error) {
    // Registration failures are non-fatal; the next lifecycle event retries.
    console.warn('[push] failed to register token', error);
  } finally {
    registering = false;
  }
}

/**
 * Handle OS token rotation. Replaces the previously registered token with the
 * new one so stale tokens do not accumulate.
 */
export async function rotatePushToken(owner: string, newToken: string): Promise<void> {
  const previousToken = currentToken;
  try {
    await apiClient.post('/push/tokens', {
      token: newToken,
      platform: Platform.OS,
      owner,
      replaces: previousToken ?? undefined,
    });
    await persistToken(newToken, owner);
  } catch (error) {
    console.warn('[push] failed to rotate token', error);
  }
}

/**
 * Invalidate and delete the token on logout or account deletion.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = currentToken;
  if (!token) {
    await clearPersistedToken();
    return;
  }
  try {
    await apiClient.delete('/push/tokens', { data: { token } });
  } catch (error) {
    // Even if the server call fails, drop the token locally so it is not
    // reused after logout.
    console.warn('[push] failed to unregister token', error);
  } finally {
    await clearPersistedToken();
  }
}

/**
 * Clean up a token the server reported as invalid/unregistered. No retries are
 * attempted to avoid retry storms.
 */
export async function handleInvalidToken(token?: string): Promise<void> {
  if (token && token !== currentToken) {
    return;
  }
  await clearPersistedToken();
}

/**
 * Subscribe to OS token rotation events.
 */
export function subscribeToTokenRefresh(owner: string): () => void {
  return messaging().onTokenRefresh((newToken) => {
    void rotatePushToken(owner, newToken);
  });
}

/**
 * Display a foreground notification. Kept for existing callers.
 */
export async function displayNotification(
  message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
  const channelId = await notifee.createChannel({
    id: 'default',
    name: 'Default',
    importance: AndroidImportance.HIGH,
  });
  await notifee.displayNotification({
    title: message.notification?.title,
    body: message.notification?.body,
    android: { channelId },
  });
}
