import { Attachment, AttachmentStatus } from '../models/Attachment';
import { SecurityScanner, ScanResult } from './SecurityScanner';
import { quarantineAttachment, shouldRetry } from '../utils/quarantine';

export class AttachmentSyncService {
  private scanner: SecurityScanner;
  private attachments: Attachment[];

  constructor(attachments: Attachment[]) {
    this.scanner = new SecurityScanner();
    this.attachments = [...attachments];
  }

  getPendingAttachments(): Attachment[] {
    return this.attachments.filter(
      (a) => a.status === AttachmentStatus.PENDING || a.status === AttachmentStatus.FAILED
    );
  }

  async processNextAttachment(): Promise<Attachment | null> {
    const pending = this.getPendingAttachments();
    if (pending.length === 0) {
      return null;
    }

    const attachment = pending[0];

    // Check if should retry
    if (!shouldRetry(attachment)) {
      return null;
    }

    try {
      // Update status to uploading
      this.updateAttachmentStatus(attachment.id, AttachmentStatus.UPLOADING);

      // Run security scan
      const scanResult = await this.scanner.scan(attachment);

      if (scanResult.result !== ScanResult.SAFE) {
        // Quarantine unsafe files
        const quarantined = quarantineAttachment(attachment, scanResult.reason || 'Unknown error');
        this.updateAttachment(quarantined);
        return quarantined;
      }

      // Simulate upload
      await this.simulateUpload(attachment);
      this.updateAttachmentStatus(attachment.id, AttachmentStatus.UPLOADED);
      return this.getAttachment(attachment.id);
    } catch (error) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const quarantined = quarantineAttachment(attachment, `Sync error: ${errorMessage}`);
      this.updateAttachment(quarantined);
      return quarantined;
    }
  }

  deleteAttachment(id: string): boolean {
    const index = this.attachments.findIndex((a) => a.id === id);
    if (index !== -1) {
      this.attachments.splice(index, 1);
      return true;
    }
    return false;
  }

  getAttachment(id: string): Attachment | undefined {
    return this.attachments.find((a) => a.id === id);
  }

  private updateAttachment(attachment: Attachment): void {
    const index = this.attachments.findIndex((a) => a.id === attachment.id);
    if (index !== -1) {
      this.attachments[index] = attachment;
    }
  }

  private updateAttachmentStatus(id: string, status: AttachmentStatus): void {
    const attachment = this.getAttachment(id);
    if (attachment) {
      attachment.status = status;
      attachment.updatedAt = Date.now();
    }
  }

  private async simulateUpload(attachment: Attachment): Promise<void> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}