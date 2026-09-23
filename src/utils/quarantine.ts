import { Attachment, AttachmentStatus } from '../models/Attachment';

export const QUARANTINE_REASON_KEY = 'quarantineReason';

export function isQuarantined(attachment: Attachment): boolean {
  return attachment.status === AttachmentStatus.QUARANTINED;
}

export function quarantineAttachment(
  attachment: Attachment,
  reason: string
): Attachment {
  return {
    ...attachment,
    status: AttachmentStatus.QUARANTINED,
    errorReason: reason,
    updatedAt: Date.now(),
    retryCount: 0, // Reset retry count to prevent re-processing
  };
}

export function shouldRetry(attachment: Attachment): boolean {
  if (isQuarantined(attachment)) {
    return false;
  }
  // Only retry if not quarantined and in failed state
  return attachment.status === AttachmentStatus.FAILED;
}