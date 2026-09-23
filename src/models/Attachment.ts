export enum AttachmentStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  UPLOADED = 'uploaded',
  FAILED = 'failed',
  QUARANTINED = 'quarantined',
}

export interface Attachment {
  id: string;
  fileName: string;
  localPath: string;
  status: AttachmentStatus;
  mimeType?: string;
  fileSize: number;
  createdAt: number;
  updatedAt: number;
  errorReason?: string;
  retryCount: number;
}