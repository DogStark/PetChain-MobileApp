import { Attachment } from '../models/Attachment';

export enum ScanResult {
  SAFE = 'safe',
  UNSAFE = 'unsafe',
  TIMEOUT = 'timeout',
  ERROR = 'error',
}

export interface ScanResultData {
  result: ScanResult;
  reason?: string;
}

export class SecurityScanner {
  private static readonly MAX_SCAN_TIME_MS = 5000;

  async scan(attachment: Attachment): Promise<ScanResultData> {
    // Simulate MIME type check
    const isSuspiciousMime = this.checkMimeSpoofing(attachment);
    if (isSuspiciousMime) {
      return {
        result: ScanResult.UNSAFE,
        reason: 'MIME spoofing detected',
      };
    }

    // Simulate timeout
    if (attachment.fileSize > 10000000) {
      // Simulate a timeout for large files
      await new Promise((resolve) => setTimeout(resolve, this.MAX_SCAN_TIME_MS + 100));
      return {
        result: ScanResult.TIMEOUT,
        reason: 'Scan timed out',
      };
    }

    // Simulate successful scan
    return {
      result: ScanResult.SAFE,
    };
  }

  private checkMimeSpoofing(attachment: Attachment): boolean {
    // Simple heuristic: if extension is .exe but mime is image, flag it
    const ext = attachment.fileName.split('.').pop()?.toLowerCase();
    if (ext === 'exe' && attachment.mimeType?.startsWith('image/')) {
      return true;
    }
    return false;
  }
}