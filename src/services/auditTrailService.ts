import axios from 'axios';

import apiClient from './apiClient';
import { logError } from '../utils/errorLogger';

export type AuditTrailAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface AuditTrailEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: AuditTrailAction;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  changedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

function unwrapApiData<T>(payload: ApiResponse<T> | T): T {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    (payload as ApiResponse<T>).success === true &&
    'data' in payload
  ) {
    return (payload as ApiResponse<T>).data;
  }
  return payload as T;
}

export class AuditTrailServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AuditTrailServiceError';
  }
}

function toServiceError(error: unknown, context: Record<string, unknown>): AuditTrailServiceError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      'Audit trail request failed';
    const code = error.response?.data?.error?.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR');
    const e = new AuditTrailServiceError(message, code, status);
    logError(e, { service: 'auditTrailService', ...context, status: status ?? null });
    return e;
  }
  const e = new AuditTrailServiceError(
    error instanceof Error ? error.message : 'Unexpected audit trail error',
    'UNKNOWN_ERROR',
  );
  logError(e, { service: 'auditTrailService', ...context });
  return e;
}

export async function getAuditTrail(params: {
  entityType: string;
  entityId: string;
  page?: number;
  limit?: number;
  action?: AuditTrailAction;
}): Promise<AuditTrailEntry[]> {
  try {
    const response = await apiClient.get(`/audit-trail`, { params });
    return unwrapApiData<AuditTrailEntry[]>(response.data);
  } catch (err) {
    throw toServiceError(err, { action: 'get_audit_trail', ...params });
  }
}

export async function exportAuditTrailCsv(params: {
  entityType: string;
  entityId: string;
}): Promise<string> {
  try {
    const response = await apiClient.get(`/audit-trail/export`, {
      params,
      responseType: 'text' as any,
    });
    return response.data as string;
  } catch (err) {
    throw toServiceError(err, { action: 'export_audit_trail', ...params });
  }
}

export default { getAuditTrail, exportAuditTrailCsv };
