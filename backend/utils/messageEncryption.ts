import { createCipheriv, createDecipheriv, createECDH, randomBytes } from 'crypto';

/**
 * Uses ECDH with P-256 (prime256v1) for key agreement and AES-256-GCM for encryption.
 * P-256 is available in both Node.js (createECDH) and browser / React Native (Web Crypto API),
 * so the backend utility and the client-side telemedicineService use the same curve.
 */
const CURVE = 'prime256v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface E2EKeyPair {
  publicKey: string; // hex-encoded P-256 public key (uncompressed, 65 bytes)
  privateKey: string; // hex-encoded P-256 private key (32 bytes)
}

export interface EncryptedMessage {
  /** Ephemeral sender public key (hex) — lets the recipient derive the shared secret */
  ephemeralPublicKey: string;
  /** AES-256-GCM IV (hex) */
  iv: string;
  /** AES-256-GCM auth tag (hex) */
  authTag: string;
  /** Encrypted ciphertext (hex) */
  ciphertext: string;
}

/** Generate a new P-256 key pair for a user/device. */
export function generateKeyPair(): E2EKeyPair {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey('hex'),
    privateKey: ecdh.getPrivateKey('hex'),
  };
}

/**
 * Encrypt plaintext for a recipient identified by their P-256 public key.
 * Uses an ephemeral key pair per message so forward secrecy is preserved
 * and the backend never sees the plaintext.
 */
export function encryptMessage(plaintext: string, recipientPublicKeyHex: string): EncryptedMessage {
  // Generate ephemeral key pair for this message
  const ephemeral = createECDH(CURVE);
  ephemeral.generateKeys();

  // Derive shared secret (32 bytes for P-256)
  const sharedSecret = ephemeral.computeSecret(Buffer.from(recipientPublicKeyHex, 'hex'));

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, sharedSecret, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ephemeralPublicKey: ephemeral.getPublicKey('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

/**
 * Decrypt a message using the recipient's private key.
 * This is called client-side only — the backend never holds private keys.
 */
export function decryptMessage(
  encrypted: EncryptedMessage,
  recipientPrivateKeyHex: string,
): string {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(Buffer.from(recipientPrivateKeyHex, 'hex'));

  const sharedSecret = ecdh.computeSecret(Buffer.from(encrypted.ephemeralPublicKey, 'hex'));

  const decipher = createDecipheriv(ALGORITHM, sharedSecret, Buffer.from(encrypted.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Serialize an EncryptedMessage to a compact JSON string for storage. */
export function serializeEncryptedMessage(msg: EncryptedMessage): string {
  return JSON.stringify(msg);
}

/** Deserialize a stored string back into an EncryptedMessage. */
export function deserializeEncryptedMessage(raw: string): EncryptedMessage {
  return JSON.parse(raw) as EncryptedMessage;
}

/** Check whether a stored content string is an E2E-encrypted payload. */
export function isEncryptedMessage(content: string): boolean {
  try {
    const obj = JSON.parse(content) as unknown;
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'ephemeralPublicKey' in obj &&
      'iv' in obj &&
      'authTag' in obj &&
      'ciphertext' in obj
    );
  } catch {
    return false;
  }
}
