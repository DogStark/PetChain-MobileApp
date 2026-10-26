/**
 * Trip itinerary checklist — Issue #1149
 *
 * Collects departure dates, destination, transport mode and the documents the
 * owner already has, then shows backend-sourced readiness checks and the
 * items still missing. Readiness is never computed locally: the server
 * decides which checks apply and whether the user may see them.
 */

import api from './api';
import { networkMonitor } from '../utils/networkMonitor';
import { isPermissionDenied, readThroughCache, type ServerReadResult } from './offlineServerCache';

export type TransportMode = 'car' | 'air' | 'train' | 'sea';
export const TRANSPORT_MODES: TransportMode[] = ['car', 'air', 'train', 'sea'];

export interface TripItineraryInput {
  petId: string;
  destination: string;
  /** ISO date (YYYY-MM-DD). */
  departureDate: string;
  /** Optional ISO date (YYYY-MM-DD). */
  returnDate?: string;
  transportMode: TransportMode;
  /** Document types the owner already holds, e.g. "rabies_certificate". */
  documents: string[];
}

export type ReadinessStatus = 'ready' | 'missing' | 'pending';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  /** Document type that satisfies this check, when applicable. */
  documentType?: string;
}

export interface TripReadiness {
  tripId: string;
  checks: ReadinessCheck[];
}

export type SubmitItineraryResult =
  | { outcome: 'saved'; tripId: string }
  | { outcome: 'invalid'; errors: string[] }
  | { outcome: 'offline' }
  | { outcome: 'permission-denied' }
  | { outcome: 'failed' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function validateItinerary(input: TripItineraryInput, today = new Date()): string[] {
  const errors: string[] = [];
  const todayIso = today.toISOString().slice(0, 10);
  if (!input.destination.trim()) errors.push('Destination is required.');
  if (!TRANSPORT_MODES.includes(input.transportMode)) errors.push('Choose a transport mode.');
  if (!isValidDate(input.departureDate)) {
    errors.push('Departure date is invalid.');
  } else if (input.departureDate < todayIso) {
    errors.push('Departure date cannot be in the past.');
  }
  if (input.returnDate) {
    if (!isValidDate(input.returnDate)) errors.push('Return date is invalid.');
    else if (input.returnDate < input.departureDate)
      errors.push('Return date must be on or after the departure date.');
  }
  return errors;
}

export async function submitItinerary(
  input: TripItineraryInput,
  today = new Date(),
): Promise<SubmitItineraryResult> {
  const errors = validateItinerary(input, today);
  if (errors.length) return { outcome: 'invalid', errors };
  if (!(await networkMonitor.isOnline())) return { outcome: 'offline' };

  try {
    const res = await api.post(`/pets/${encodeURIComponent(input.petId)}/trips`, {
      destination: input.destination.trim(),
      departureDate: input.departureDate,
      returnDate: input.returnDate,
      transportMode: input.transportMode,
      documents: input.documents,
    });
    const tripId = (res?.data as { id?: unknown } | undefined)?.id;
    return typeof tripId === 'string' ? { outcome: 'saved', tripId } : { outcome: 'failed' };
  } catch (error) {
    return isPermissionDenied(error) ? { outcome: 'permission-denied' } : { outcome: 'failed' };
  }
}

function normalizeReadiness(raw: unknown): TripReadiness | null {
  const r = raw as { tripId?: unknown; checks?: unknown } | null;
  if (!r || typeof r.tripId !== 'string' || !Array.isArray(r.checks)) return null;
  const checks = r.checks.flatMap((c): ReadinessCheck[] => {
    const v = c as Record<string, unknown> | null;
    if (!v || typeof v.id !== 'string' || typeof v.label !== 'string') return [];
    const status: ReadinessStatus =
      v.status === 'ready' || v.status === 'missing' ? v.status : 'pending';
    return [
      {
        id: v.id,
        label: v.label,
        status,
        documentType: typeof v.documentType === 'string' ? v.documentType : undefined,
      },
    ];
  });
  return { tripId: r.tripId, checks };
}

export function loadTripReadiness(
  petId: string,
  tripId: string,
  opts: { now?: number; retryDelayMs?: number } = {},
): Promise<ServerReadResult<TripReadiness>> {
  const path = `/pets/${encodeURIComponent(petId)}/trips/${encodeURIComponent(tripId)}/readiness`;
  return readThroughCache({
    cacheKey: `tripReadiness:${petId}:${tripId}`,
    fetch: async () => (await api.get(path)).data,
    normalize: normalizeReadiness,
    // Readiness rules change with travel regulations; flag it after 6 hours.
    staleAfterMs: 6 * 60 * 60 * 1000,
    ...opts,
  });
}

/**
 * Checks the owner still has to resolve. A server "missing" check is
 * considered resolved locally once the owner lists the matching document,
 * pending server confirmation.
 */
export function getMissingItems(readiness: TripReadiness, documents: string[]): ReadinessCheck[] {
  const held = new Set(documents);
  return readiness.checks.filter(
    (c) => c.status === 'missing' && !(c.documentType && held.has(c.documentType)),
  );
}

export function getReadinessAccessibilityLabel(check: ReadinessCheck): string {
  const state =
    check.status === 'ready' ? 'ready' : check.status === 'missing' ? 'missing' : 'awaiting check';
  return `${check.label}: ${state}`;
}
