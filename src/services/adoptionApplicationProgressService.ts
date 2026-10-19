import { localDB } from '../storage/localDB';
import { withRetry } from '../utils/withRetry';

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

export interface AdoptionApplicationProgress {
  applicantId: string;
  applicationId: string;
  steps: AdoptionProgressStep[];
  documents: AdoptionProgressDocument[];
  review: AdoptionProgressReview;
  updatedAt: string;
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

const CACHE_KEY_PREFIX = 'adoptionApplicationProgress:';
const DEFAULT_ENDPOINT = '/adoption/applications/progress';

function getCacheKey(applicantId: string): string {
  return `${CACHE_KEY_PREFIX}${applicantId}`;
}

function getEndpoint(applicationId?: string): string {
  const base =
    (typeof process !== 'undefined' && process.env && process.env.ADOPTION_PROGRESS_ENDPOINT) ||
    DEFAULT_ENDPOINT;
  if (applicationId) {
    return `${base}?applicationId=${encodeURIComponent(applicationId)}`;
  }
  return base;
}

function getAuthToken(): string | null {
  try {
    // Token is resolved by the shared API client / session layer.
    const session = localDB.get('session') as { token?: string } | null | undefined;
    return session?.token ?? null;
  } catch {
    return null;
  }
}

function getCurrentUserId(): string | null {
  try {
    const session = localDB.get('session') as { user?: { id?: string } } | null | undefined;
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { name?: string; message?: string; code?: string };
  if (err.name === 'TypeError' && /fetch|network/i.test(err.message ?? '')) return true;
  if (err.code === 'NETWORK_ERROR' || err.code === 'ECONNABORTED') return true;
  if (/network request failed|failed to fetch|offline/i.test(err.message ?? '')) return true;
  return false;
}

function mapHttpStatusToKind(status: number): AdoptionProgressErrorKind {
  if (status === 401 || status === 403) return 'permission-denied';
  if (status >= 500) return 'server-error';
  return 'unknown';
}

function isRetryable(kind: AdoptionProgressErrorKind): boolean {
  return kind === 'server-error' || kind === 'offline';
}

function validatePayload(
  payload: unknown,
  currentUserId: string,
): AdoptionApplicationProgress {
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
    steps: data.steps as AdoptionProgressStep[],
    documents: data.documents as AdoptionProgressDocument[],
    review: data.review as AdoptionProgressReview,
    updatedAt: data.updatedAt,
  };
}

async function fetchProgress(
  currentUserId: string,
  applicationId?: string,
): Promise<AdoptionApplicationProgress> {
  const token = getAuthToken();
  if (!token) {
    throw new AdoptionProgressError('permission-denied', 'No authenticated session');
  }

  let response: Response;
  try {
    response = await fetch(getEndpoint(applicationId), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    if (isNetworkError(error)) {
      throw new AdoptionProgressError('offline', 'Network unavailable');
    }
    throw new AdoptionProgressError('unknown', 'Failed to fetch progress');
  }

  if (!response.ok) {
    const kind = mapHttpStatusToKind(response.status);
    throw new AdoptionProgressError(kind, `Progress request failed (${response.status})`, response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AdoptionProgressError('invalid-response', 'Failed to parse progress response');
  }

  return validatePayload(json, currentUserId);
}

function readCache(applicantId: string): AdoptionApplicationProgress | null {
  try {
    const cached = localDB.get(getCacheKey(applicantId)) as
      | { data?: AdoptionApplicationProgress }
      | null
      | undefined;
    if (cached && cached.data && cached.data.applicantId === applicantId) {
      return cached.data;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(applicantId: string, data: AdoptionApplicationProgress): void {
  try {
    localDB.set(getCacheKey(applicantId), { data });
  } catch {
    // Cache write failures must not break the flow.
  }
}

export async function getAdoptionApplicationProgress(
  applicationId?: string,
): Promise<AdoptionProgressResult> {
  const currentUserId = getCurrentUserId();
  if (!currentUserId) {
    return {
      data: null,
      error: 'permission-denied',
      lastUpdatedAt: null,
      fromCache: false,
    };
  }

  try {
    const data = await withRetry(
      () => fetchProgress(currentUserId, applicationId),
      {
        retries: 2,
        shouldRetry: (error: unknown) => {
          if (error instanceof AdoptionProgressError) {
            return isRetryable(error.kind);
          }
          return false;
        },
      },
    );

    writeCache(currentUserId, data);

    return {
      data,
      error: null,
      lastUpdatedAt: data.updatedAt,
      fromCache: false,
    };
  } catch (error) {
    const kind: AdoptionProgressErrorKind =
      error instanceof AdoptionProgressError ? error.kind : 'unknown';

    const cached = readCache(currentUserId);

    if (kind === 'offline' || kind === 'server-error') {
      // Fall back to last successful payload for offline display.
      return {
        data: cached,
        error: kind,
        lastUpdatedAt: cached?.updatedAt ?? null,
        fromCache: cached !== null,
      };
    }

    return {
      data: null,
      error: kind,
      lastUpdatedAt: null,
      fromCache: false,
    };
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

export function clearAdoptionProgressCache(applicantId?: string): void {
  try {
    const id = applicantId ?? getCurrentUserId();
    if (!id) return;
    localDB.remove(getCacheKey(id));
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