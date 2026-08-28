import type { MedicalDocumentMetadata, MedicalDocumentType } from '../models/MedicalRecord';

const IMAGE_MIME_PREFIX = 'image/';

export function getMedicalDocumentType(
  document: Pick<MedicalDocumentMetadata, 'mimeType' | 'name'>,
): MedicalDocumentType {
  const mimeType = document.mimeType.toLowerCase();
  const name = document.name.toLowerCase();

  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }

  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) {
    return 'image';
  }

  return 'other';
}

export function isImageDocument(document: MedicalDocumentMetadata): boolean {
  return getMedicalDocumentType(document) === 'image';
}

export function isPdfDocument(document: MedicalDocumentMetadata): boolean {
  return getMedicalDocumentType(document) === 'pdf';
}

export function formatFileSize(sizeBytes?: number): string | null {
  if (!sizeBytes || sizeBytes <= 0) {
    return null;
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kb = sizeBytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  }

  const mb = kb / 1024;
  return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function getAttachmentLabel(document: MedicalDocumentMetadata): string {
  const type = getMedicalDocumentType(document);
  if (type === 'image') {
    return 'Image attachment';
  }
  if (type === 'pdf') {
    return 'PDF attachment';
  }
  return 'Document attachment';
}

export function normalizeDocuments(
  documents?: MedicalDocumentMetadata[] | null,
): MedicalDocumentMetadata[] {
  return [...(documents ?? [])].filter((document) => Boolean(document?.url && document?.name));
}
