/**
 * Audit service — fetches and displays audit trail events for HIPAA compliance
 */

import axios from 'axios';
import type { AxiosResponse } from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'pet.created'
  | 'pet.updated'
  | 'pet.deleted'
  | 'medical_record.created'
  | 'medical_record.updated'
  | 'medical_record.deleted'
  | 'medical_record.accessed'
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.deleted'
  | 'medication.created'
  | 'medication.updated'
  | 'medication.deleted';

export type AuditResourceType = 'user' | 'pet' | 'medical_record' | 'appointment' | 'medication';

export interface AuditLog {
  id: string;
  actorId: string;
  actorEmail: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  meta?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface AuditLogQuery {
  actorId?: string;
  action?: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedAuditResponse {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Fetch audit logs with optional filters
 */
export const getAuditLogs = async (
  query?: AuditLogQuery,
): Promise<AxiosResponse<PaginatedAuditResponse>> => {
  const params = new URLSearchParams();

  if (query?.actorId) params.append('actorId', query.actorId);
  if (query?.action) params.append('action', query.action);
  if (query?.resourceType) params.append('resourceType', query.resourceType);
  if (query?.resourceId) params.append('resourceId', query.resourceId);
  if (query?.startDate) params.append('startDate', query.startDate);
  if (query?.endDate) params.append('endDate', query.endDate);
  if (query?.page) params.append('page', String(query.page));
  if (query?.limit) params.append('limit', String(query.limit));

  try {
    return await axios.get<PaginatedAuditResponse>(
      `${API_BASE_URL}/audit-logs?${params.toString()}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      throw new Error('Network error: Unable to reach audit service');
    }
    throw error;
  }
};

/**
 * Get icon for audit action
 */
export const getAuditActionIcon = (action: AuditAction): string => {
  const iconMap: Record<AuditAction, string> = {
    'user.login': '🔓',
    'user.logout': '🔒',
    'user.created': '👤',
    'user.updated': '✏️',
    'user.deleted': '🗑️',
    'pet.created': '🐾',
    'pet.updated': '✏️',
    'pet.deleted': '🗑️',
    'medical_record.created': '📋',
    'medical_record.updated': '✏️',
    'medical_record.deleted': '🗑️',
    'medical_record.accessed': '👁️',
    'appointment.created': '📅',
    'appointment.updated': '✏️',
    'appointment.deleted': '🗑️',
    'medication.created': '💊',
    'medication.updated': '✏️',
    'medication.deleted': '🗑️',
  };
  return iconMap[action] || '📌';
};

/**
 * Get human-readable label for audit action
 */
export const getAuditActionLabel = (action: AuditAction): string => {
  const labels: Record<AuditAction, string> = {
    'user.login': 'Logged in',
    'user.logout': 'Logged out',
    'user.created': 'Account created',
    'user.updated': 'Profile updated',
    'user.deleted': 'Account deleted',
    'pet.created': 'Pet added',
    'pet.updated': 'Pet info updated',
    'pet.deleted': 'Pet removed',
    'medical_record.created': 'Record created',
    'medical_record.updated': 'Record updated',
    'medical_record.deleted': 'Record deleted',
    'medical_record.accessed': 'Record viewed',
    'appointment.created': 'Appointment scheduled',
    'appointment.updated': 'Appointment updated',
    'appointment.deleted': 'Appointment cancelled',
    'medication.created': 'Medication added',
    'medication.updated': 'Medication updated',
    'medication.deleted': 'Medication removed',
  };
  return labels[action] || action;
};

export default { getAuditLogs, getAuditActionIcon, getAuditActionLabel };
