import {
  formatFileSize,
  getAttachmentLabel,
  getMedicalDocumentType,
  isImageDocument,
  isPdfDocument,
  normalizeDocuments,
} from '../medicalRecordAttachments';

describe('medicalRecordAttachments', () => {
  const pdfDocument = {
    id: 'doc-1',
    name: 'Lab Results.pdf',
    mimeType: 'application/pdf',
    type: 'pdf' as const,
    url: 'https://example.com/lab-results.pdf',
  };

  const imageDocument = {
    id: 'doc-2',
    name: 'X-ray.jpg',
    mimeType: 'image/jpeg',
    type: 'image' as const,
    url: 'https://example.com/xray.jpg',
  };

  it('detects document types from mime type and file name', () => {
    expect(getMedicalDocumentType(pdfDocument)).toBe('pdf');
    expect(getMedicalDocumentType(imageDocument)).toBe('image');
  });

  it('identifies images and pdfs', () => {
    expect(isImageDocument(imageDocument)).toBe(true);
    expect(isPdfDocument(pdfDocument)).toBe(true);
  });

  it('formats file sizes nicely', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2 MB');
  });

  it('returns a friendly label for attachments', () => {
    expect(getAttachmentLabel(pdfDocument)).toBe('PDF attachment');
    expect(getAttachmentLabel(imageDocument)).toBe('Image attachment');
  });

  it('filters out incomplete documents', () => {
    expect(
      normalizeDocuments([
        pdfDocument,
        { id: 'doc-3', name: '', mimeType: 'application/pdf', type: 'pdf', url: '' },
      ] as any),
    ).toEqual([pdfDocument]);
  });
});
