import {
  extractTextFromPdf,
  validatePdfFile,
  processPdfFromBase64,
  processPdfFromUrl,
} from '../pdfExtractionService';

// Mock pdf-parse
jest.mock('pdf-parse', () => {
  return jest.fn().mockImplementation((buffer) => {
    // Simulate PDF parsing
    if (buffer.toString().includes('INVALID')) {
      throw new Error('Invalid PDF');
    }
    return Promise.resolve({
      text: 'Sample extracted text from PDF',
      numPages: 3,
    });
  });
});

// Mock tesseract.js
jest.mock('tesseract.js', () => ({
  createWorker: jest.fn().mockResolvedValue({
    recognize: jest.fn().mockResolvedValue({
      data: { text: 'OCR extracted text' },
    }),
    terminate: jest.fn().mockResolvedValue(undefined),
  }),
}));

// Mock fetch
global.fetch = jest.fn();

describe('pdfExtractionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePdfFile', () => {
    it('should validate a valid PDF file', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n%test content');
      const result = validatePdfFile(pdfBuffer);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject file without PDF signature', () => {
      const invalidBuffer = Buffer.from('NOT A PDF');
      const result = validatePdfFile(invalidBuffer);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid PDF file');
    });

    it('should reject file exceeding size limit', () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      largeBuffer.write('%PDF-1.4');
      const result = validatePdfFile(largeBuffer, { maxSizeMb: 10 });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should accept file within custom size limit', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n' + 'x'.repeat(5 * 1024 * 1024)); // 5MB
      const result = validatePdfFile(pdfBuffer, { maxSizeMb: 10 });

      expect(result.valid).toBe(true);
    });
  });

  describe('extractTextFromPdf', () => {
    it('should extract text from valid PDF', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\ntest content');
      const result = await extractTextFromPdf(pdfBuffer);

      expect(result.success).toBe(true);
      expect(result.text).toContain('Sample extracted text');
      expect(result.pageCount).toBe(3);
      expect(result.isScanned).toBe(false);
    });

    it('should handle PDF extraction timeout', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\ntest');
      const result = await extractTextFromPdf(pdfBuffer, { timeout: 1 });

      // Note: This test may be flaky due to timing
      // In production, consider using jest.useFakeTimers()
      expect(result.success).toBe(false);
    });

    it('should limit text to maxPages', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\ntest');
      const result = await extractTextFromPdf(pdfBuffer, { maxPages: 1 });

      expect(result.success).toBe(true);
      expect(result.pageCount).toBeLessThanOrEqual(1);
    });

    it('should handle extraction errors gracefully', async () => {
      const invalidBuffer = Buffer.from('INVALID PDF CONTENT');
      const result = await extractTextFromPdf(invalidBuffer);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('processPdfFromBase64', () => {
    it('should process valid base64 PDF', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\ntest content');
      const base64 = pdfBuffer.toString('base64');

      const result = await processPdfFromBase64(base64);

      expect(result.success).toBe(true);
      expect(result.text).toBeDefined();
    });

    it('should reject invalid base64', async () => {
      const result = await processPdfFromBase64('not-valid-base64!!!');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject base64 without PDF signature', async () => {
      const invalidBuffer = Buffer.from('NOT A PDF');
      const base64 = invalidBuffer.toString('base64');

      const result = await processPdfFromBase64(base64);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PDF');
    });

    it('should pass options to extraction', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\ntest');
      const base64 = pdfBuffer.toString('base64');

      const result = await processPdfFromBase64(base64, { maxPages: 2 });

      expect(result.success).toBe(true);
      expect(result.pageCount).toBeLessThanOrEqual(2);
    });
  });

  describe('processPdfFromUrl', () => {
    it('should fetch and process PDF from URL', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\ntest content');
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValueOnce(pdfBuffer.buffer),
      });

      const result = await processPdfFromUrl('https://example.com/test.pdf');

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/test.pdf');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await processPdfFromUrl('https://example.com/notfound.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 404');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await processPdfFromUrl('https://example.com/test.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should pass options to extraction', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\ntest');
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValueOnce(pdfBuffer.buffer),
      });

      const result = await processPdfFromUrl('https://example.com/test.pdf', {
        maxPages: 5,
      });

      expect(result.success).toBe(true);
    });
  });
});
