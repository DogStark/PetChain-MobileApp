/**
 * Security session service — lists the user's active sessions and revokes
 * them remotely.
 *
 * Permissions are server-owned: `canRevoke` and `isCurrent` come from the API,
 * and anything the server does not explicitly mark as revocable is treated as
 * non-revocable. A revocation is only reported as successful once the server
 * confirms it; callers should update their local list from that confirmation,
 * never optimistically.
 */

import apiClient from './apiClient';
import { API_ENDPOINTS } from '../config/apiEndpoints';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SecuritySession {
  id: string;
  /** Human-readable device label, e.g. "iPhone 14 Pro" */
  deviceLabel: string;
  createdAt: string;
  lastActiveAt: string;
  /** True for the session making the request — revoking it would sign the user out */
  isCurrent: boolean;
  /** Server-confirmed permission to revoke this session */
  canRevoke: boolean;
}

export class SecuritySessionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SecuritySessionError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSecuritySessionError(error: unknown): SecuritySessionError {
  if (error instanceof SecuritySessionError) return error;
  if (error instanceof Error) {
    const axiosErr = error as any;
    if (axiosErr.isAxiosError) {
      const status: number | undefined = axiosErr.response?.status;
      const msg =
        axiosErr.response?.data?.error?.message ||
        axiosErr.response?.data?.message ||
        axiosErr.message;
      return new SecuritySessionError(msg, `HTTP_${status ?? 'UNKNOWN'}`, status);
    }
    return new SecuritySessionError(error.message, 'UNKNOWN_ERROR');
  }
  return new SecuritySessionError('Unexpected session error', 'UNKNOWN_ERROR');
}

/**
 * Keep only well-formed session entries. Malformed entries are dropped rather
 * than rendered, and permissions default to denied when the server omits them.
 */
function parseSessions(raw: unknown): SecuritySession[] {
  if (!Array.isArray(raw)) {
    throw new SecuritySessionError('Malformed session list response', 'MALFORMED_RESPONSE');
  }

  return raw.flatMap((entry): SecuritySession[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.lastActiveAt !== 'string') return [];

    return [
      {
        id: item.id,
        deviceLabel:
          typeof item.deviceLabel === 'string' && item.deviceLabel.trim()
            ? item.deviceLabel
            : 'Unknown device',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.lastActiveAt,
        lastActiveAt: item.lastActiveAt,
        isCurrent: item.isCurrent === true,
        canRevoke: item.canRevoke === true,
      },
    ];
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch the user's active sessions. */
export async function listSecuritySessions(): Promise<SecuritySession[]> {
  try {
    const response = await apiClient.get(API_ENDPOINTS.auth.sessions.list);
    return parseSessions(response.data?.data?.sessions);
  } catch (error) {
    throw toSecuritySessionError(error);
  }
}

/**
 * Revoke a session remotely. Resolves only when the server confirms the
 * revocation with a 2xx response that does not report `success: false`.
 */
export async function revokeSecuritySession(sessionId: string): Promise<void> {
  try {
    const response = await apiClient.delete(API_ENDPOINTS.auth.sessions.revoke(sessionId));
    const confirmed =
      response.status >= 200 && response.status < 300 && response.data?.success !== false;
    if (!confirmed) {
      throw new SecuritySessionError('Session revocation was not confirmed', 'NOT_CONFIRMED');
    }
  } catch (error) {
    throw toSecuritySessionError(error);
  }
}

const securitySessionService = {
  listSecuritySessions,
  revokeSecuritySession,
};

export default securitySessionService;
