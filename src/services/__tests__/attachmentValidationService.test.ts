import {
  MAX_ATTACHMENT_BYTES,
  looksExecutable,
  safeDownloadHeaders,
  sanitizeFilename,
  sniffContentType,
  validateAttachment,
} from '../attachmentValidationService';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
const TEXT = new Uint8Array(Buffer.from('synthetic discharge summary\n', 'utf8'));

describe('attachmentValidationService', () => {
  describe('sniffContentType', () => {
    it('recognises real magic bytes', () => {
      expect(sniffContentType(PNG)).toBe('image/png');
      expect(sniffContentType(JPEG)).toBe('image/jpeg');
      expect(sniffContentType(PDF)).toBe('application/pdf');
      expect(sniffContentType(TEXT)).toBe('text/plain');
    });

    it('returns null for binary garbage', () => {
      expect(sniffContentType(new Uint8Array([0x00, 0x01, 0x02, 0xff]))).toBeNull();
    });
  });

  describe('looksExecutable', () => {
    it('flags native binaries and embedded scripts', () => {
      expect(looksExecutable(PE)).toMatch(/executable/);
      expect(looksExecutable(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toMatch(/ELF/);
      expect(looksExecutable(new Uint8Array(Buffer.from('<html><script>x()</script>')))).toMatch(
        /script/,
      );
    });
    it('does not flag a plain image', () => {
      expect(looksExecutable(PNG)).toBeNull();
    });
  });

  describe('sanitizeFilename', () => {
    it('strips paths, traversal and unsafe characters', () => {
      expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('my report (1).pdf')).toBe('my_report_1_.pdf');
      expect(sanitizeFilename('')).toBe('attachment');
    });
  });

  describe('validateAttachment', () => {
    it('accepts an allowed image whose declared type matches', () => {
      const result = validateAttachment({
        filename: 'xray.png',
        declaredContentType: 'image/png',
        bytes: PNG,
      });
      expect(result).toMatchObject({ ok: true, quarantined: false, detectedContentType: 'image/png' });
    });

    it('quarantines a content-type spoof', () => {
      const result = validateAttachment({
        filename: 'invoice.pdf',
        declaredContentType: 'application/pdf',
        bytes: PNG,
      });
      expect(result).toMatchObject({ ok: false, quarantined: true });
      expect(result.reason).toMatch(/does not match/);
    });

    it('quarantines an executable disguised as an image', () => {
      const result = validateAttachment({
        filename: 'cute-puppy.png',
        declaredContentType: 'image/png',
        bytes: PE,
      });
      expect(result).toMatchObject({ ok: false, quarantined: true });
      expect(result.reason).toMatch(/executable/);
    });

    it('rejects empty and oversized files without quarantine', () => {
      expect(validateAttachment({ filename: 'a', declaredContentType: '', bytes: new Uint8Array() })).
        toMatchObject({ ok: false, quarantined: false, reason: 'empty file' });

      const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
      huge.set(PNG);
      expect(
        validateAttachment({ filename: 'big.png', declaredContentType: 'image/png', bytes: huge }),
      ).toMatchObject({ ok: false, quarantined: false, reason: 'file exceeds size limit' });
    });

    it('rejects unrecognised content types', () => {
      const result = validateAttachment({
        filename: 'thing.bin',
        declaredContentType: 'application/octet-stream',
        bytes: new Uint8Array([0x00, 0x11, 0x22, 0x33]),
      });
      expect(result).toMatchObject({ ok: false, quarantined: true });
    });
  });

  describe('safeDownloadHeaders', () => {
    it('forces a sandboxed attachment download', () => {
      const headers = safeDownloadHeaders('xray.png', 'image/png');
      expect(headers['Content-Disposition']).toBe('attachment; filename="xray.png"');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['Content-Security-Policy']).toContain('sandbox');
    });
  });
});
