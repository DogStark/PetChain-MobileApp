import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import config from '../config';

type ConfigWithPins = typeof config & { api?: { pins?: string[]; pinUrl?: string } };
const cfg = config as ConfigWithPins;

const PIN_STORE_KEY = 'cert_pins_v1';
export const SIGNING_KEY_STORE_KEY = 'request_signing_key_v1';

/**
 * Retrieve (or lazily create) the per-session HMAC signing key from SecureStore.
 * The key is a 32-byte random hex string tied to the user's session.
 */
export async function getSigningKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(SIGNING_KEY_STORE_KEY);
  if (stored) return stored;
  const key = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${Math.random()}-${Date.now()}`,
  );
  await SecureStore.setItemAsync(SIGNING_KEY_STORE_KEY, key);
  return key;
}

/**
 * Clear the signing key (call on logout / session wipe).
 */
export async function clearSigningKey(): Promise<void> {
  await SecureStore.deleteItemAsync(SIGNING_KEY_STORE_KEY);
}

/**
 * Build the canonical string that is signed: body + timestamp + nonce.
 */
export function buildSignaturePayload(body: string, timestamp: string, nonce: string): string {
  return `${body}|${timestamp}|${nonce}`;
}

/**
 * Compute HMAC-SHA256 of `payload` using `key`.
 * Uses the Web Crypto API available in React Native (via expo-crypto / hermes).
 */
export async function computeHmacSha256(key: string, payload: string): Promise<string> {
  // TextEncoder available globally in Hermes / modern RN
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Produce the three request-signing headers to attach to every outbound API call.
 *
 * X-Request-Timestamp : ISO timestamp string
 * X-Request-Nonce     : 16-byte random hex
 * X-Request-Signature : HMAC-SHA256(body + "|" + timestamp + "|" + nonce, signingKey)
 */
export async function buildSignatureHeaders(body: string): Promise<{
  'X-Request-Timestamp': string;
  'X-Request-Nonce': string;
  'X-Request-Signature': string;
}> {
  const signingKey = await getSigningKey();
  const timestamp = new Date().toISOString();
  const nonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${Math.random()}-${Date.now()}`,
  ).then((h) => h.slice(0, 32));

  const payload = buildSignaturePayload(body, timestamp, nonce);
  const signature = await computeHmacSha256(signingKey, payload);

  return {
    'X-Request-Timestamp': timestamp,
    'X-Request-Nonce': nonce,
    'X-Request-Signature': signature,
  };
}

/**
 * Load pinned certs from secure store and config. Returns array of pin identifiers.
 */
export async function loadPins(): Promise<string[]> {
  try {
    const stored = await SecureStore.getItemAsync(PIN_STORE_KEY);
    const cfgPins = cfg.api?.pins ?? [];
    const storedPins = stored ? JSON.parse(stored) : [];
    return Array.from(new Set([...cfgPins, ...storedPins]));
  } catch {
    return cfg.api?.pins ?? [];
  }
}

/**
 * Persist new set of pins (used when rotating/updating pins)
 */
export async function savePins(pins: string[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(PIN_STORE_KEY, JSON.stringify(pins));
  } catch {
    // ignore
  }
}

/**
 * Optionally fetch pins from a remote management endpoint and update stored pins.
 * The endpoint is expected to return JSON { pins: string[] }.
 */
export async function refreshPinsFromRemote(): Promise<string[] | null> {
  const url = cfg.api?.pinUrl;
  if (!url) return null;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const body = await res.json();
    if (Array.isArray(body.pins)) {
      await savePins(body.pins);
      return body.pins;
    }
    return null;
  } catch {
    return null;
  }
}

export default {
  loadPins,
  savePins,
  refreshPinsFromRemote,
};
