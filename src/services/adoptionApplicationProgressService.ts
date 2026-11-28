import apiClient from './apiClient';
import { getCurrentAccountId } from './authService';
import { getItem, removeItem, setItem } from './localDB';
import { withRetry } from '../utils/retry';

export type AdoptionProgressErrorKind =
  | 'permission-denied'
  | 'server-error'
  | 'offline'
  | 'invalid-response'
  | 'unknown';

export interface AdoptionProgressStep {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'blocked';
  dueDate?: string | null;
  completedAt?: string | null;
}

export interface AdoptionProgressDocument {
  id: string;
  name: string;
  status: 'requested' | 'uploaded' | 'under-review' | 'approved' | 'rejected';
  requestedAt?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export interface AdoptionProgressReview {
  status: 'not-started' | 'in-review' | 'changes-requested' | 'approved' | 'rejected';
  reviewerName?: string | null;
  updatedAt?: string | null;
  comments?: string | null;
}

/** Server-provided contact and appeal paths. Absent when the shelter has not published them. */
export interface AdoptionProgressContact {
  email?: string | null;
  appealUrl?: string | null;
}

export interface AdoptionApplicationProgress {
  applicantId: string;
  applicationId: string;
  steps: AdoptionProgressStep[];
  documents: AdoptionProgressDocument[];
  review: AdoptionProgressReview;
  updatedAt: string;
  /** Timeline milestones. Each is null until the server has reached that milestone. */
  submittedAt?: string | null;
  matchedAt?: string | null;
  closedAt?: string | null;
  contact?: AdoptionProgressContact | null;
}

export interface AdoptionProgressResult {
  data: AdoptionApplicationProgress | null;
  error: AdoptionProgressErrorKind | null;
  lastUpdatedAt: string | null;
  fromCache: boolean;
}

export class AdoptionProgressError extends Error {
  kind: AdoptionProgressErrorKind;
  status?: number;

  constructor(kind: AdoptionProgressErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AdoptionProgressError';
    this.kind = kind;
    this.status = status;
  }
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

const CACHE_KEY_PREFIX = 'adoptionApplicationProgress:';
const BASE_URL = '/adoption/applications/progress';

function getCacheKey(applicantId: string): string {
  return `${CACHE_KEY_PREFIX}${applicantId}`;
}

function mapHttpStatusToKind(status: number): AdoptionProgressErrorKind {
  if (status === 401 || status === 403) return 'permission-denied';
  if (status >= 500) return 'server-error';
  return 'unknown';
}

function toErrorKind(error: unknown): AdoptionProgressErrorKind {
  if (error instanceof AdoptionProgressError) return error.kind;
  const err = error as { response?: { status?: number }; request?: unknown };
  if (err?.response?.status) return mapHttpStatusToKind(err.response.status);
  if (err?.request) return 'offline';
  return 'unknown';
}

function validatePayload(payload: unknown, currentUserId: string): AdoptionApplicationProgress {
  if (!payload || typeof payload !== 'object') {
    throw new AdoptionProgressError('invalid-response', 'Malformed progress payload');
  }
  const data = payload as Partial<AdoptionApplicationProgress>;
  if (typeof data.applicantId !== 'string' || data.applicantId.length === 0) {
    throw new AdoptionProgressError('invalid-response', 'Missing applicantId in payload');
  }
  if (data.applicantId !== currentUserId) {
    // Reject cross-applicant data to protect privacy.
    throw new AdoptionProgressError(
      'permission-denied',
      'Progress payload does not belong to the current applicant',
    );
  }
  if (typeof data.applicationId !== 'string' || data.applicationId.length === 0) {
    throw new AdoptionProgressError('invalid-response', 'Missing applicationId in payload');
  }
  if (!Array.isArray(data.steps)) {
    throw new AdoptionProgressError('invalid-response', 'Missing steps in payload');
  }
  if (!Array.isArray(data.documents)) {
    throw new AdoptionProgressError('invalid-response', 'Missing documents in payload');
  }
  if (!data.review || typeof data.review !== 'object') {
    throw new AdoptionProgressError('invalid-response', 'Missing review in payload');
  }
  if (typeof data.updatedAt !== 'string' || data.updatedAt.length === 0) {
    throw new AdoptionProgressError('invalid-response', 'Missing updatedAt in payload');
  }

  return {
    applicantId: data.applicantId,
    applicationId: data.applicationId,
    steps: data.steps,
    documents: data.documents,
    review: data.review,
    updatedAt: data.updatedAt,
    submittedAt: data.submittedAt ?? null,
    matchedAt: data.matchedAt ?? null,
    closedAt: data.closedAt ?? null,
    contact: data.contact ?? null,
  };
}

async function readCache(applicantId: string): Promise<AdoptionApplicationProgress | null> {
  try {
    const raw = await getItem(getCacheKey(applicantId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as { data?: AdoptionApplicationProgress } | null;
    if (cached?.data && cached.data.applicantId === applicantId) {
      return cached.data;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCache(applicantId: string, data: AdoptionApplicationProgress): Promise<void> {
  try {
    await setItem(getCacheKey(applicantId), JSON.stringify({ data }));
  } catch {
    // Cache write failures must not break the flow.
  }
}

export async function getAdoptionApplicationProgress(
  applicationId?: string,
): Promise<AdoptionProgressResult> {
  const currentUserId = await getCurrentAccountId();
  if (!currentUserId) {
    return { data: null, error: 'permission-denied', lastUpdatedAt: null, fromCache: false };
  }

  try {
    const response = await withRetry(
      () =>
        apiClient.get<ApiResponse<AdoptionApplicationProgress>>(BASE_URL, {
          params: applicationId ? { applicationId } : undefined,
        }),
      { maxRetries: 2, initialDelay: 500 },
    );
    const data = validatePayload(response.data?.data, currentUserId);

    await writeCache(currentUserId, data);

    return { data, error: null, lastUpdatedAt: data.updatedAt, fromCache: false };
  } catch (error) {
    const kind = toErrorKind(error);

    if (kind === 'offline' || kind === 'server-error') {
      // Fall back to the last payload for this applicant. Never show a different application.
      const cached = await readCache(currentUserId);
      const usable = cached && (!applicationId || cached.applicationId === applicationId);
      return {
        data: usable ? cached : null,
        error: kind,
        lastUpdatedAt: usable ? cached.updatedAt : null,
        fromCache: Boolean(usable),
      };
    }

    return { data: null, error: kind, lastUpdatedAt: null, fromCache: false };
  }
}

export function isProgressStale(
  lastUpdatedAt: string | null,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  now: number = Date.now(),
): boolean {
  if (!lastUpdatedAt) return true;
  const updated = Date.parse(lastUpdatedAt);
  if (Number.isNaN(updated)) return true;
  return now - updated > maxAgeMs;
}

export async function clearAdoptionProgressCache(applicantId?: string): Promise<void> {
  try {
    const id = applicantId ?? (await getCurrentAccountId());
    if (!id) return;
    await removeItem(getCacheKey(id));
  } catch {
    // Ignore cache clear failures.
  }
}

export const adoptionApplicationProgressService = {
  getAdoptionApplicationProgress,
  isProgressStale,
  clearAdoptionProgressCache,
};

export default adoptionApplicationProgressService;
