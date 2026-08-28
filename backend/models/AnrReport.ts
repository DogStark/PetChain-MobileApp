/**
 * ANR/Hang monitoring report payload from mobile clients.
 */
export interface AnrReportPayload {
  platform: 'android' | 'ios';
  type: 'anr' | 'hang';
  timestamp: string; // ISO 8601 timestamp
  threadName: string;
  stackTrace: string;
  appVersion?: string;
  osVersion?: string;
  deviceModel?: string;
  additionalInfo?: Record<string, unknown>;
}

/**
 * Stored ANR report with metadata.
 */
export interface AnrReport {
  id: string;
  userId?: string; // Optional: link to user if authenticated
  payload: AnrReportPayload;
  createdAt: string;
  processed: boolean;
  rootCause?: string; // For manual annotation
}

/**
 * Validation result for ANR reports.
 */
export interface ValidationResult {
  isValid: boolean;
  error: string | null;
}

/**
 * ANR report creation input (same as payload).
 */
export type CreateAnrReportInput = AnrReportPayload;

/**
 * ANR report update input for processing.
 */
export interface UpdateAnrReportInput {
  processed?: boolean;
  rootCause?: string;
}

/**
 * ANR report query filters.
 */
export interface AnrReportFilters {
  platform?: 'android' | 'ios';
  type?: 'anr' | 'hang';
  appVersion?: string;
  osVersion?: string;
  processed?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * ANR report statistics.
 */
export interface AnrReportStats {
  totalReports: number;
  androidReports: number;
  iosReports: number;
  anrReports: number;
  hangReports: number;
  processedReports: number;
  unprocessedReports: number;
  topAppVersions: Array<{ version: string; count: number }>;
  topOsVersions: Array<{ version: string; count: number }>;
  recentReports: AnrReport[];
}

/**
 * ANR report service interface.
 */
export interface IAnrReportService {
  createReport(input: CreateAnrReportInput, userId?: string): Promise<AnrReport>;
  getReport(id: string): Promise<AnrReport | null>;
  updateReport(id: string, input: UpdateAnrReportInput): Promise<AnrReport | null>;
  listReports(filters: AnrReportFilters): Promise<AnrReport[]>;
  getStats(filters?: Partial<AnrReportFilters>): Promise<AnrReportStats>;
  deleteReport(id: string): Promise<boolean>;
}

/**
 * ANR report validation utilities.
 */
export { AnrReportValidator } from '../utils/anrValidators';

/**
 * ANR report processing utilities.
 */
export class AnrReportProcessor {
  /**
   * Extract potential root cause from stack trace.
   */
  static extractRootCause(stackTrace: string): string | null {
    const lines = stackTrace.split('\n').filter((line) => line.trim());

    // Look for common blocking patterns
    const blockingPatterns = [
      /at.*\.sleep\(/i,
      /at.*\.wait\(/i,
      /at.*\.join\(/i,
      /at.*\.lock\(/i,
      /at.*\.synchronized/i,
      /at.*dispatch_sync/i,
      /at.*performSelector/i,
      /at.*runModalForWindow/i,
    ];

    for (const line of lines) {
      for (const pattern of blockingPatterns) {
        if (pattern.test(line)) {
          return `Potential blocking operation: ${line.trim()}`;
        }
      }
    }

    // If no specific pattern, return the top frame
    const topFrame = lines[0]?.trim();
    return topFrame ? `Top frame: ${topFrame}` : null;
  }

  /**
   * Group similar reports by stack trace similarity.
   */
  static groupSimilarReports(reports: AnrReport[]): Map<string, AnrReport[]> {
    const groups = new Map<string, AnrReport[]>();

    for (const report of reports) {
      const key = this.generateSimilarityKey(report.payload.stackTrace);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(report);
    }

    return groups;
  }

  private static generateSimilarityKey(stackTrace: string): string {
    // Simple similarity: hash of first 3 stack frames
    const lines = stackTrace.split('\n').slice(0, 3).join('\n');
    return this.simpleHash(lines);
  }

  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }
}
