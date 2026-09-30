/**
 * Server-side byte validation for telemedicine chat attachments.
 *
 * Uploaded files are untrusted: the declared MIME type and filename are
 * attacker-controlled. This module sniffs the actual leading bytes, enforces a
 * size ceiling and an allowlist, quarantines anything that fails, and produces
 * safe download headers so a browser/webview never renders an attachment inline.
 */

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MiB

export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export interface AttachmentInput {
  filename: string;
  declaredContentType: string;
  bytes: Uint8Array;
}

export interface AttachmentValidationResult {
  ok: boolean;
  detectedContentType: string | null;
  sanitizedFilename: string;
  sizeBytes: number;
  quarantined: boolean;
  reason?: string;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** Returns a canonical content type from magic bytes, or null if unrecognised. */
export function sniffContentType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  if (isProbablyText(bytes)) return 'text/plain';
  return null;
}

const EXECUTABLE_SIGNATURES: { label: string; sig: number[]; offset?: number }[] = [
  { label: 'DOS/PE executable', sig: [0x4d, 0x5a] },
  { label: 'ELF binary', sig: [0x7f, 0x45, 0x4c, 0x46] },
  { label: 'Mach-O binary', sig: [0xfe, 0xed, 0xfa, 0xce] },
  { label: 'Mach-O binary', sig: [0xcf, 0xfa, 0xed, 0xfe] },
  { label: 'Java class', sig: [0xca, 0xfe, 0xba, 0xbe] },
  { label: 'shell script', sig: [0x23, 0x21] }, // #!
];

export function looksExecutable(bytes: Uint8Array): string | null {
  for (const entry of EXECUTABLE_SIGNATURES) {
    if (startsWith(bytes, entry.sig, entry.offset ?? 0)) return entry.label;
  }
  const head = Buffer.from(bytes.subarray(0, 512)).toString('latin1').toLowerCase();
  if (head.includes('<script') || head.includes('<?php')) return 'embedded script';
  return null;
}

function isProbablyText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 512);
  if (sample.length === 0) return false;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

export function sanitizeFilename(filename: string): string {
  const base = (filename.split(/[\\/]/).pop() ?? 'attachment').trim();
  const cleaned = base.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(0, 128);
  return cleaned || 'attachment';
}

export function validateAttachment(input: AttachmentInput): AttachmentValidationResult {
  const sanitizedFilename = sanitizeFilename(input.filename);
  const sizeBytes = input.bytes.byteLength;
  const base = { detectedContentType: null as string | null, sanitizedFilename, sizeBytes };

  if (sizeBytes === 0) {
    return { ...base, ok: false, quarantined: false, reason: 'empty file' };
  }
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ...base, ok: false, quarantined: false, reason: 'file exceeds size limit' };
  }

  const executableLabel = looksExecutable(input.bytes);
  if (executableLabel) {
    return {
      ...base,
      ok: false,
      quarantined: true,
      reason: `blocked ${executableLabel}`,
    };
  }

  const detected = sniffContentType(input.bytes);
  if (!detected || !ALLOWED_CONTENT_TYPES.includes(detected as AllowedContentType)) {
    return {
      ...base,
      detectedContentType: detected,
      ok: false,
      quarantined: true,
      reason: 'unsupported or unrecognised content type',
    };
  }

  const declared = input.declaredContentType.split(';')[0].trim().toLowerCase();
  if (declared && declared !== detected) {
    return {
      ...base,
      detectedContentType: detected,
      ok: false,
      quarantined: true,
      reason: `declared type ${declared} does not match detected ${detected}`,
    };
  }

  return { ...base, detectedContentType: detected, ok: true, quarantined: false };
}

/** Headers that force a download and prevent inline rendering / MIME sniffing. */
export function safeDownloadHeaders(
  sanitizedFilename: string,
  detectedContentType: string,
): Record<string, string> {
  return {
    'Content-Type': detectedContentType,
    'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  };
}
