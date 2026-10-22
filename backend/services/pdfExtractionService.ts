/**
 * PDF Extraction Service
 *
 * Handles PDF file processing, text extraction, and OCR fallback for scanned documents.
 * Uses pdf-parse for text extraction and provides OCR support via Tesseract.js.
 */

import type { PdfParseResult } from './pdfParserService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PdfExtractionOptions {
  maxPages?: number;
  timeout?: number;
  enableOcr?: boolean;
}

// ─── PDF Extraction ───────────────────────────────────────────────────────────

/**
 * Extract text from PDF buffer
 *
 * This function requires pdf-parse to be installed:
 * npm install pdf-parse
 *
 * For production use with OCR support, also install:
 * npm install tesseract.js
 */
export async function extractTextFromPdf(
  pdfBuffer: Buffer,
  options: PdfExtractionOptions = {},
): Promise<PdfParseResult> {
  const { maxPages = 20, timeout = 30000, enableOcr = false } = options;

  try {
    // Dynamically import pdf-parse to avoid hard dependency
    let pdfParse: (
      buffer: Buffer,
      options?: Record<string, unknown>,
    ) => Promise<{ text: string; numpages: number }>;
    try {
      const pdfParseModule = require('pdf-parse');
      pdfParse = pdfParseModule.default ?? pdfParseModule;
    } catch {
      return {
        success: false,
        text: '',
        pageCount: 0,
        isScanned: false,
        error: 'pdf-parse library not installed. Install with: npm install pdf-parse',
      };
    }

    // Extract text from PDF
    const data = await Promise.race([
      pdfParse(pdfBuffer),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PDF extraction timeout')), timeout),
      ),
    ]);

    let text = data.text || '';
    let isScanned = false;

    // Check if text extraction was successful
    if (!text || text.trim().length < 50) {
      // Likely a scanned document, try OCR if enabled
      if (enableOcr) {
        try {
          text = await extractTextWithOcr(pdfBuffer, maxPages);
          isScanned = true;
        } catch (ocrError) {
          return {
            success: false,
            text: '',
            pageCount: data.numpages || 0,
            isScanned: true,
            error: `PDF appears to be scanned and OCR failed: ${ocrError instanceof Error ? ocrError.message : 'Unknown error'}`,
          };
        }
      } else {
        return {
          success: false,
          text: '',
          pageCount: data.numpages || 0,
          isScanned: true,
          error: 'PDF appears to be scanned. Enable OCR or provide a text-based PDF.',
        };
      }
    }

    // Limit to maxPages worth of text
    const lines = text.split('\n');
    const avgLinesPerPage = Math.max(1, Math.floor(lines.length / (data.numpages || 1)));
    const maxLines = maxPages * avgLinesPerPage;
    const limitedText = lines.slice(0, maxLines).join('\n');

    return {
      success: true,
      text: limitedText,
      pageCount: Math.min(data.numpages || 0, maxPages),
      isScanned,
    };
  } catch (error) {
    return {
      success: false,
      text: '',
      pageCount: 0,
      isScanned: false,
      error: `PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extract text from PDF using OCR (Tesseract.js)
 *
 * Requires tesseract.js to be installed:
 * npm install tesseract.js
 */
async function extractTextWithOcr(pdfBuffer: Buffer, maxPages: number): Promise<string> {
  try {
    // Dynamically import tesseract.js to avoid hard dependency
    let Tesseract: typeof import('tesseract.js');
    try {
      Tesseract = require('tesseract.js');
    } catch {
      throw new Error('tesseract.js library not installed. Install with: npm install tesseract.js');
    }

    // For OCR, we would need to convert PDF pages to images first
    // This is a simplified implementation that assumes the buffer is already an image
    // In production, use pdf2image or similar to convert PDF pages to images first

    const worker = await Tesseract.createWorker();
    try {
      const result = await worker.recognize(pdfBuffer);
      return result.data.text;
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    throw new Error(
      `OCR extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Validate PDF file
 */
export function validatePdfFile(
  buffer: Buffer,
  options: { maxSizeMb?: number } = {},
): { valid: boolean; error?: string } {
  const { maxSizeMb = 10 } = options;

  // Check file size
  const sizeMb = buffer.length / (1024 * 1024);
  if (sizeMb > maxSizeMb) {
    return {
      valid: false,
      error: `PDF file too large. Maximum size is ${maxSizeMb}MB, got ${sizeMb.toFixed(2)}MB`,
    };
  }

  // Check PDF signature
  const pdfSignature = buffer.slice(0, 4).toString('ascii');
  if (pdfSignature !== '%PDF') {
    return {
      valid: false,
      error: 'Invalid PDF file. File does not start with PDF signature.',
    };
  }

  return { valid: true };
}

/**
 * Process PDF file from base64 string
 */
export async function processPdfFromBase64(
  base64Data: string,
  options: PdfExtractionOptions = {},
): Promise<PdfParseResult> {
  try {
    // Decode base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');

    // Validate PDF
    const validation = validatePdfFile(buffer);
    if (!validation.valid) {
      return {
        success: false,
        text: '',
        pageCount: 0,
        isScanned: false,
        error: validation.error,
      };
    }

    // Extract text
    return await extractTextFromPdf(buffer, options);
  } catch (error) {
    return {
      success: false,
      text: '',
      pageCount: 0,
      isScanned: false,
      error: `Failed to process PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Process PDF file from URL
 */
export async function processPdfFromUrl(
  url: string,
  options: PdfExtractionOptions = {},
): Promise<PdfParseResult> {
  try {
    // Fetch PDF from URL
    const response = await fetch(url);
    if (!response.ok) {
      return {
        success: false,
        text: '',
        pageCount: 0,
        isScanned: false,
        error: `Failed to fetch PDF: HTTP ${response.status}`,
      };
    }

    const buffer = await response.arrayBuffer();
    return await extractTextFromPdf(Buffer.from(buffer), options);
  } catch (error) {
    return {
      success: false,
      text: '',
      pageCount: 0,
      isScanned: false,
      error: `Failed to process PDF from URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
