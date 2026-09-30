import {
  MAX_MEDICAL_FILE_BYTES,
  MIN_MEDICAL_FILE_BYTES,
  looksEncryptedPdf,
  validateMedicalImportFile,
} from '../medicalFileValidation';

const b64 = (s: string) => Buffer.from(s, 'binary').toString('base64');

// Minimal synthetic payloads — no real documents / PII.
const plainPdf = b64(`%PDF-1.4\n${'x'.repeat(400)}\ntrailer<< /Root 1 0 R >>\n%%EOF`);
const encryptedPdf = b64(
  `%PDF-1.4\n${'x'.repeat(400)}\ntrailer<< /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF`,
);
const pngBytes = b64('\x89PNG\r\n\x1a\n' + 'y'.repeat(400));

describe('validateMedicalImportFile (#962)', () => {
  const okPdf = {
    name: 'record.pdf',
    size: 5000,
    mimeType: 'application/pdf',
    base64: plainPdf,
  };

  it('accepts a well-formed PDF within limits', () => {
    const res = validateMedicalImportFile(okPdf);
    expect(res).toMatchObject({ ok: true, code: 'ok', resolvedType: 'application/pdf' });
  });

  it('rejects an empty file', () => {
    expect(validateMedicalImportFile({ name: 'x.pdf', size: 0 }).code).toBe('empty');
  });

  it('rejects a file below the minimum size', () => {
    expect(
      validateMedicalImportFile({ name: 'x.pdf', size: MIN_MEDICAL_FILE_BYTES - 1 }).code,
    ).toBe('too-small');
  });

  it('rejects an oversized file', () => {
    const res = validateMedicalImportFile({
      name: 'huge.pdf',
      size: MAX_MEDICAL_FILE_BYTES + 1,
      mimeType: 'application/pdf',
    });
    expect(res.code).toBe('too-large');
    expect(res.message).toMatch(/MB or smaller/);
  });

  it('rejects an unsupported type', () => {
    expect(
      validateMedicalImportFile({ name: 'notes.docx', size: 5000, mimeType: 'application/msword' })
        .code,
    ).toBe('unsupported-type');
  });

  it('rejects when reported MIME and extension disagree', () => {
    expect(
      validateMedicalImportFile({ name: 'record.png', size: 5000, mimeType: 'application/pdf' })
        .code,
    ).toBe('extension-mismatch');
  });

  it('rejects a PDF whose bytes are not actually a PDF (malformed)', () => {
    expect(
      validateMedicalImportFile({
        name: 'record.pdf',
        size: 5000,
        mimeType: 'application/pdf',
        base64: b64('GIF89a not a pdf at all'),
      }).code,
    ).toBe('malformed');
  });

  it('rejects a password-protected / encrypted PDF', () => {
    const res = validateMedicalImportFile({ ...okPdf, base64: encryptedPdf });
    expect(res.code).toBe('encrypted');
    expect(res.message).toMatch(/password/i);
  });

  it('resolves type from extension when the picker reports no MIME', () => {
    const res = validateMedicalImportFile({ name: 'scan.PNG', size: 5000, base64: pngBytes });
    expect(res).toMatchObject({ ok: true, resolvedType: 'image/png' });
  });

  it('never leaks file bytes in the user-facing message', () => {
    const res = validateMedicalImportFile({ ...okPdf, base64: encryptedPdf });
    expect(res.message).not.toContain(encryptedPdf.slice(0, 20));
  });

  describe('looksEncryptedPdf', () => {
    it('is true for an /Encrypt trailer', () => {
      expect(looksEncryptedPdf(encryptedPdf)).toBe(true);
    });
    it('is false for a plain PDF', () => {
      expect(looksEncryptedPdf(plainPdf)).toBe(false);
    });
  });
});
