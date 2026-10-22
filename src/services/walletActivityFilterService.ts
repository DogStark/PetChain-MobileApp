/**
 * Transaction activity filters for pet expenses — Issue #1159
 *
 * Filters wallet activity by pet, date range and status. Filtering happens on
 * the server; pagination follows only server-provided links. Results expose
 * explicit empty and pending states so the UI never shows a silent blank list.
 */

import api from './api';
import { readThroughCache, type ServerReadResult } from './offlineServerCache';

export type ActivityStatus = 'pending' | 'confirmed' | 'failed';
export const ACTIVITY_STATUSES: ActivityStatus[] = ['pending', 'confirmed', 'failed'];

export interface ActivityFilters {
  petId?: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  to?: string;
  status?: ActivityStatus;
}

export interface WalletActivity {
  id: string;
  petId: string | null;
  amount: string;
  asset: string;
  status: ActivityStatus;
  createdAt: string;
  /** Server-provided link to transaction details, if any. */
  detailsLink?: string;
}

export interface ActivityPage {
  items: WalletActivity[];
  /** Server-provided link to the next page, or null when there is none. */
  nextLink: string | null;
}

export type ActivityViewState = 'empty' | 'pending-only' | 'has-results';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVITY_PATH = '/wallet/activity';

export function validateFilters(filters: ActivityFilters): string[] {
  const errors: string[] = [];
  if (filters.from && !DATE_RE.test(filters.from)) errors.push('Start date is invalid.');
  if (filters.to && !DATE_RE.test(filters.to)) errors.push('End date is invalid.');
  if (filters.from && filters.to && filters.from > filters.to)
    errors.push('Start date must be on or before the end date.');
  if (filters.status && !ACTIVITY_STATUSES.includes(filters.status))
    errors.push('Unknown status filter.');
  return errors;
}

export function buildFilterParams(filters: ActivityFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.petId) params.petId = filters.petId;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.status) params.status = filters.status;
  return params;
}

/** Only accept app-relative links from the server for the activity endpoint. */
export function isSafeServerLink(link: unknown): link is string {
  return typeof link === 'string' && link.startsWith(`${ACTIVITY_PATH}`) && !link.includes('//');
}

function normalizePage(raw: unknown): ActivityPage | null {
  const r = raw as { items?: unknown; links?: { next?: unknown } } | null;
  if (!r || !Array.isArray(r.items)) return null;
  const items = r.items.flatMap((i): WalletActivity[] => {
    const v = i as Record<string, unknown> | null;
    if (!v || typeof v.id !== 'string' || typeof v.createdAt !== 'string') return [];
    if (!ACTIVITY_STATUSES.includes(v.status as ActivityStatus)) return [];
    const links = (v.links ?? {}) as Record<string, unknown>;
    return [
      {
        id: v.id,
        petId: typeof v.petId === 'string' ? v.petId : null,
        amount: typeof v.amount === 'string' ? v.amount : String(v.amount ?? '0'),
        asset: typeof v.asset === 'string' ? v.asset : 'XLM',
        status: v.status as ActivityStatus,
        createdAt: v.createdAt,
        detailsLink: typeof links.details === 'string' ? links.details : undefined,
      },
    ];
  });
  return { items, nextLink: isSafeServerLink(r.links?.next) ? r.links.next : null };
}

function cacheKeyFor(filters: ActivityFilters): string {
  const p = buildFilterParams(filters);
  return `walletActivity:${['petId', 'from', 'to', 'status'].map((k) => p[k] ?? '').join('|')}`;
}

/** Loads the first page for the given filters (cached for offline viewing). */
export function loadFilteredActivity(
  filters: ActivityFilters,
  opts: { now?: number; retryDelayMs?: number } = {},
): Promise<ServerReadResult<ActivityPage>> {
  return readThroughCache({
    cacheKey: cacheKeyFor(filters),
    fetch: async () => (await api.get(ACTIVITY_PATH, { params: buildFilterParams(filters) })).data,
    normalize: normalizePage,
    staleAfterMs: 15 * 60 * 1000,
    ...opts,
  });
}

/** Loads the next page by following the server-provided link only. */
export async function loadNextActivityPage(nextLink: string): Promise<ActivityPage | null> {
  if (!isSafeServerLink(nextLink)) return null;
  return normalizePage((await api.get(nextLink)).data);
}

export function getActivityViewState(items: WalletActivity[]): ActivityViewState {
  if (items.length === 0) return 'empty';
  return items.every((i) => i.status === 'pending') ? 'pending-only' : 'has-results';
}

export function getEmptyStateMessage(filters: ActivityFilters, state: ActivityViewState): string {
  if (state === 'pending-only')
    return 'Only pending transactions match. They may take a few minutes to confirm.';
  if (state !== 'empty') return '';
  return Object.keys(buildFilterParams(filters)).length
    ? 'No transactions match these filters.'
    : 'No wallet activity yet.';
}

export function getActivityAccessibilityLabel(item: WalletActivity): string {
  const date = item.createdAt.slice(0, 10);
  return `${item.amount} ${item.asset}, ${item.status}, ${date}`;
}
