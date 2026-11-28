/**
 * Pet Expense History Export — Issue #1166
 *
 * Requests a date-filtered CSV export of a pet's expense history. Permission
 * is decided by the server (never inferred on the client), generation is
 * asynchronous, and any download link is short-lived: the client treats an
 * export as expired once `expiresAt` has passed, even if the server still
 * reports it as ready.
 */

import { resilientRequest } from './apiClient';

export type ExpenseExportStatus = 'queued' | 'generating' | 'ready' | 'failed';

export interface ExpenseExportPermission {
  canExport: boolean;
}

export interface ExpenseExportRequest {
  petId: string;
  /** Inclusive start date, YYYY-MM-DD. */
  from: string;
  /** Inclusive end date, YYYY-MM-DD. */
  to: string;
}

export interface ExpenseExport {
  id: string;
  petId: string;
  status: ExpenseExportStatus;
  from: string;
  to: string;
  requestedAt: string;
  /** Present only once status is `ready`. */
  downloadUrl?: string;
  /** When the download link stops working (ISO 8601). */
  expiresAt?: string;
}

export type ExpenseExportErrorCode =
  | 'PERMISSION_DENIED'
  | 'INVALID_DATE'
  | 'RANGE_REVERSED'
  | 'RANGE_TOO_LARGE'
  | 'NETWORK'
  | 'FAILED';

export class ExpenseExportError extends Error {
  constructor(
    message: string,
    public readonly code: ExpenseExportErrorCode,
  ) {
    super(message);
    this.name = 'ExpenseExportError';
  }
}

/** Largest date window a single export may cover (inclusive, in days). */
export const MAX_EXPORT_RANGE_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a YYYY-MM-DD range before any network call. Returns the first
 * problem found, or `null` when the range can be requested.
 */
export function validateExpenseDateRange(from: string, to: string): ExpenseExportErrorCode | null {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return 'INVALID_DATE';

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 'INVALID_DATE';
  if (start > end) return 'RANGE_REVERSED';

  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > MAX_EXPORT_RANGE_DAYS) return 'RANGE_TOO_LARGE';

  return null;
}

/** True when the export's download link has passed its expiry. */
export function isExpenseExportExpired(exp: ExpenseExport, now: number = Date.now()): boolean {
  return exp.expiresAt !== undefined && Date.parse(exp.expiresAt) <= now;
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function toExpenseExportError(err: unknown, fallback: string): ExpenseExportError {
  const status = statusOf(err);
  if (status === 403) {
    return new ExpenseExportError('You do not have permission to export this pet', 'PERMISSION_DENIED');
  }
  if (status === undefined) {
    return new ExpenseExportError('Network unavailable — try again when online', 'NETWORK');
  }
  return new ExpenseExportError(fallback, 'FAILED');
}

/** Ask the server whether the current user may export this pet's expenses. */
export async function getExpenseExportPermission(petId: string): Promise<ExpenseExportPermission> {
  try {
    const res = await resilientRequest<{ data: ExpenseExportPermission }>({
      method: 'GET',
      url: `/pets/${petId}/expenses/export/permission`,
    });
    return res.data.data;
  } catch (err) {
    throw toExpenseExportError(err, 'Failed to check export permission');
  }
}

/** Queue a new expense export for the given date range. */
export async function requestExpenseExport(req: ExpenseExportRequest): Promise<ExpenseExport> {
  const rangeError = validateExpenseDateRange(req.from, req.to);
  if (rangeError) {
    throw new ExpenseExportError('Choose a valid date range', rangeError);
  }

  try {
    const res = await resilientRequest<{ data: ExpenseExport }>({
      method: 'POST',
      url: `/pets/${req.petId}/expenses/exports`,
      data: { from: req.from, to: req.to, format: 'csv' },
    });
    return res.data.data;
  } catch (err) {
    throw toExpenseExportError(err, 'Failed to request expense export');
  }
}

/** Fetch the latest status of a previously requested export. */
export async function getExpenseExport(petId: string, exportId: string): Promise<ExpenseExport> {
  try {
    const res = await resilientRequest<{ data: ExpenseExport }>({
      method: 'GET',
      url: `/pets/${petId}/expenses/exports/${exportId}`,
    });
    return res.data.data;
  } catch (err) {
    throw toExpenseExportError(err, 'Failed to fetch export status');
  }
}
