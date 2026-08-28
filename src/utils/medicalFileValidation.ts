/**
 * Pre-parse validation for imported medical documents (issue #962).
 *
 * Imported files may be oversized, malformed, password-protected, or hostile.
 * Validate BEFORE handing bytes to any parser: enforce a type allow-list and a
 * size cap, reject obviously encrypted or structurally broken PDFs, and return
 * a short, non-leaking error string safe to show the user.
 */

/** Hard ceiling for an imported document. Anything larger is rejected outright. */
export const MAX_MEDICAL_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Below this a "file" is almost certainly truncated / not a real document. */
export const MIN_MEDICAL_FILE_BYTES = 64;

/** MIME types we are willing to parse. */
export const ALLOWED_MEDICAL_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
] as const;

export type AllowedMedicalMimeType = (typeof ALLOWED_MEDICAL_MIME_TYPES)[number];

const EXTENSION_TO_MIME: Record<string, AllowedMedicalMimeType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

/** Leading magic bytes for the formats we accept, as byte arrays. */
const MAGIC_BYTES: Partial<Record<AllowedMedicalMimeType, number[]>> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export interface MedicalFileInput {
  /** Original filename, used only for the extension check. */
  name: string;
  /** Size in bytes. */
  size: number;
  /** MIME type reported by the picker, if any. */
  mimeType?: string | null;
  /** Base64-encoded file contents, if already loaded (enables content checks). */
  base64?: string | null;
}

export interface MedicalFileValidationResult {
  ok: boolean;
  /** Machine-readable reason, for tests / analytics (no file content). */
  code:
    | 'ok'
    | 'empty'
    | 'too-small'
    | 'too-large'
    | 'unsupported-type'
    | 'extension-mismatch'
    | 'encrypted'
    | 'malformed';
  /** Short, user-safe message. Never contains file bytes or PII. */
  message: string;
  /** Resolved MIME type when validation passes. */
  resolvedType?: AllowedMedicalMimeType;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function decodeBase64Prefix(b64: string, chars: number): string {
  const clean = b64.replace(/\s/g, '').slice(0, chars);
  try {
    if (typeof atob === 'function') return atob(clean);
    // Node / RN without atob
    return Buffer.from(clean, 'base64').toString('binary');
  } catch {
    return '';
  }
}

/**
 * Detect a password-protected / encrypted PDF from its base64 payload without
 * fully parsing it: encrypted PDFs contain an `/Encrypt` entry in the trailer.
 */
export function looksEncryptedPdf(base64: string): boolean {
  const head = decodeBase64Prefix(base64, 4096);
  const tail = decodeBase64Prefix(base64.replace(/\s/g, '').slice(-8192), Number.MAX_SAFE_INTEGER);
  return /\/Encrypt(\s|\/|>|\d)/.test(head) || /\/Encrypt(\s|\/|>|\d)/.test(tail);
}

/**
 * Validate an imported medical file before any parsing happens.
 * Pure and synchronous — safe to call on the JS thread.
 */
export function validateMedicalImportFile(file: MedicalFileInput): MedicalFileValidationResult {
  if (!file || file.size <= 0) {
    return { ok: false, code: 'empty', message: 'That file appears to be empty.' };
  }
  if (file.size < MIN_MEDICAL_FILE_BYTES) {
    return {
      ok: false,
      code: 'too-small',
      message: 'That file is too small to be a valid document.',
    };
  }
  if (file.size > MAX_MEDICAL_FILE_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      message: `Files must be ${Math.floor(MAX_MEDICAL_FILE_BYTES / (1024 * 1024))} MB or smaller.`,
    };
  }

  const ext = extensionOf(file.name);
  const extMime = EXTENSION_TO_MIME[ext];
  const reported = (file.mimeType ?? '').toLowerCase().split(';')[0].trim();
  const reportedAllowed = ALLOWED_MEDICAL_MIME_TYPES.includes(reported as AllowedMedicalMimeType)
    ? (reported as AllowedMedicalMimeType)
    : undefined;

  const resolvedType = reportedAllowed ?? extMime;
  if (!resolvedType) {
    return {
      ok: false,
      code: 'unsupported-type',
      message: 'Only PDF, JPEG, PNG, or HEIC files can be imported.',
    };
  }
  if (reportedAllowed && extMime && reportedAllowed !== extMime) {
    return {
      ok: false,
      code: 'extension-mismatch',
      message: 'The file type and its extension do not match.',
    };
  }

  if (file.base64) {
    const b64 = file.base64.replace(/\s/g, '');
    const expected = MAGIC_BYTES[resolvedType];
    if (expected) {
      const head = decodeBase64Prefix(b64, Math.ceil((expected.length + 2) / 3) * 4);
      const matches = expected.every((byte, i) => head.charCodeAt(i) === byte);
      if (!matches) {
        return {
          ok: false,
          code: 'malformed',
          message: 'That file is not a readable document.',
        };
      }
    }
    if (resolvedType === 'application/pdf' && looksEncryptedPdf(b64)) {
      return {
        ok: false,
        code: 'encrypted',
        message: 'Password-protected PDFs cannot be imported. Remove the password and try again.',
      };
    }
  }

  return { ok: true, code: 'ok', message: '', resolvedType };
}
