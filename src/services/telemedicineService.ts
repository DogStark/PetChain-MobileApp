import apiClient from './apiClient';
import type { Appointment, AppointmentType } from '../models/Appointment';

const TELEMEDICINE_ENDPOINT = '/telemedicine';

export interface TelemedicineAvailabilitySlot {
  date: string;
  time: string;
  display: string;
  startUtc: string;
  endUtc: string;
  timeZone: string;
}

export interface ScheduleTelemedicineAppointmentInput {
  petId: string;
  vetId: string;
  date: string;
  time: string;
  timeZone: string;
  durationMinutes?: number;
  type?: AppointmentType;
  notes?: string;
}

// ─── E2E Encryption (client-side only) ───────────────────────────────────────

export interface E2EKeyPair {
  publicKey: string; // hex-encoded X25519 public key
  privateKey: string; // hex-encoded X25519 private key (stored in device secure storage only)
}

export interface EncryptedChatMessage {
  ephemeralPublicKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Generates a new X25519 key pair for this device.
 * The private key must be stored in device secure storage (e.g. expo-secure-store / react-native-keychain).
 * The public key is uploaded to the user's profile so others can encrypt messages to them.
 */
export async function generateChatKeyPair(): Promise<E2EKeyPair> {
  // React Native / Expo environments use the Web Crypto API (available via global.crypto)
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);

  const [publicKeyBuffer, privateKeyBuffer] = await Promise.all([
    crypto.subtle.exportKey('raw', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);

  return {
    publicKey: bufferToHex(publicKeyBuffer),
    privateKey: bufferToHex(privateKeyBuffer),
  };
}

/**
 * Encrypts a plaintext chat message for a recipient identified by their public key.
 * Uses ECDH key agreement + AES-256-GCM (P-256 curve, available via Web Crypto).
 */
export async function encryptChatMessage(
  plaintext: string,
  recipientPublicKeyHex: string,
): Promise<string> {
  // Import recipient's public key
  const recipientKey = await crypto.subtle.importKey(
    'raw',
    hexToBuffer(recipientPublicKeyHex),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // Generate an ephemeral key pair for this message
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);

  // Derive a 256-bit AES key from the ECDH shared secret
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipientKey },
    ephemeral.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  // AES-GCM appends the 16-byte auth tag at the end of the ciphertext
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const ciphertext = ciphertextBytes.slice(0, -16);
  const authTag = ciphertextBytes.slice(-16);

  const ephemeralPublicKeyBuffer = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

  const payload: EncryptedChatMessage = {
    ephemeralPublicKey: bufferToHex(ephemeralPublicKeyBuffer),
    iv: bufferToHex(iv),
    authTag: bufferToHex(authTag),
    ciphertext: bufferToHex(ciphertext),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts an encrypted chat message using the current user's private key.
 * Call this client-side after receiving a message from the backend.
 */
export async function decryptChatMessage(
  encryptedJson: string,
  recipientPrivateKeyHex: string,
): Promise<string> {
  const payload: EncryptedChatMessage = JSON.parse(encryptedJson);

  // Import recipient private key (pkcs8 format)
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    hexToBuffer(recipientPrivateKeyHex),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  );

  // Import sender's ephemeral public key
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'raw',
    hexToBuffer(payload.ephemeralPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // Derive the same AES key
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: ephemeralPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  // Re-combine ciphertext + auth tag (Web Crypto AES-GCM expects them concatenated)
  const ciphertextBytes = hexToBuffer(payload.ciphertext);
  const authTagBytes = hexToBuffer(payload.authTag);
  const combined = new Uint8Array(ciphertextBytes.byteLength + authTagBytes.byteLength);
  combined.set(new Uint8Array(ciphertextBytes), 0);
  combined.set(new Uint8Array(authTagBytes), ciphertextBytes.byteLength);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuffer(payload.iv) },
    aesKey,
    combined,
  );

  return new TextDecoder().decode(plaintextBuffer);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}

// ─── Telemedicine API calls ───────────────────────────────────────────────────

export async function getTelemedicineAvailability(
  vetId: string,
  timeZone: string,
  date?: string,
): Promise<TelemedicineAvailabilitySlot[]> {
  try {
    const params = new URLSearchParams({ vetId, timeZone });
    if (date) params.set('date', date);
    const response = await apiClient.get<{ data: { slots: TelemedicineAvailabilitySlot[] } }>(
      `${TELEMEDICINE_ENDPOINT}/availability?${params.toString()}`,
    );
    return response.data.data.slots;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export async function scheduleTelemedicineAppointment(
  input: ScheduleTelemedicineAppointmentInput,
): Promise<Appointment> {
  try {
    const response = await apiClient.post<{ data: Appointment }>(
      `${TELEMEDICINE_ENDPOINT}/appointments`,
      input,
    );
    return response.data.data;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export async function submitTelemedicineQuestionnaire(
  appointmentId: string,
  responses: Record<string, string>,
): Promise<Appointment> {
  try {
    const response = await apiClient.post<{ data: Appointment }>(
      `${TELEMEDICINE_ENDPOINT}/${encodeURIComponent(appointmentId)}/questionnaire`,
      { responses },
    );
    return response.data.data;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export async function reportTelemedicineNoShow(
  appointmentId: string,
  reason?: string,
): Promise<Appointment> {
  try {
    const response = await apiClient.post<{ data: Appointment }>(
      `${TELEMEDICINE_ENDPOINT}/${encodeURIComponent(appointmentId)}/no-show`,
      { reason },
    );
    return response.data.data;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export async function rescheduleTelemedicineAppointment(
  appointmentId: string,
  payload: { date: string; time: string; timeZone: string },
): Promise<Appointment> {
  try {
    const response = await apiClient.post<{ data: Appointment }>(
      `${TELEMEDICINE_ENDPOINT}/${encodeURIComponent(appointmentId)}/reschedule`,
      payload,
    );
    return response.data.data;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Uploads the user's chat public key to their profile.
 * Must be called after generateChatKeyPair() when setting up a new device.
 */
export async function uploadChatPublicKey(publicKey: string): Promise<void> {
  try {
    await apiClient.patch('/users/me', { chatPublicKey: publicKey });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Fetches the chat public key for a given user (vet or owner).
 * Used by the sender to encrypt messages before sending.
 */
export async function getChatPublicKey(userId: string): Promise<string> {
  try {
    const response = await apiClient.get<{ data: { chatPublicKey: string } }>(
      `/users/${encodeURIComponent(userId)}/chat-public-key`,
    );
    return response.data.data.chatPublicKey;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}
