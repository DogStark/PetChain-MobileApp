/**
 * Deep links to specific pet care tasks — Issue #1192
 *
 * Validates `pets/:petId/tasks/:taskId` links (see navigation/deepLinks.ts)
 * and confirms with the server that the user can still access the pet before
 * opening the task. Inaccessible pets fall back to the pet list without
 * revealing whether the pet exists. Offline, the last server-confirmed access
 * is reused so cached tasks still open.
 */

import api from './api';
import { readThroughCache } from './offlineServerCache';
import { parseDeepLink } from '../navigation/deepLinks';

export type TaskLinkFallbackReason = 'invalid_link' | 'no_access' | 'unverified';

export type TaskLinkResolution =
  | { screen: 'PetCareTask'; params: { petId: string; taskId: string }; offline: boolean }
  | { screen: 'PetList'; reason: TaskLinkFallbackReason; accessibilityLabel: string };

const FALLBACK_LABELS: Record<TaskLinkFallbackReason, string> = {
  invalid_link: 'This link is not supported. Showing your pets instead.',
  no_access: 'This task is not available. Showing your pets instead.',
  unverified: 'Connect to the internet to open this task. Showing your pets instead.',
};

const accessKey = (petId: string) => `petTaskAccess:${petId}`;

function fallback(reason: TaskLinkFallbackReason): TaskLinkResolution {
  return { screen: 'PetList', reason, accessibilityLabel: FALLBACK_LABELS[reason] };
}

export async function resolvePetTaskLink(url: string): Promise<TaskLinkResolution> {
  const link = parseDeepLink(url);
  if (!link || link.route !== 'PetCareTask') return fallback('invalid_link');
  const { petId, taskId } = link.params;

  const access = await readThroughCache<boolean>({
    cacheKey: accessKey(petId),
    fetch: async () => (await api.get(`/pets/${encodeURIComponent(petId)}/permissions`)).data,
    normalize: (raw) => {
      const canView = (raw as { canView?: unknown } | null)?.canView;
      return typeof canView === 'boolean' ? canView : null;
    },
  });

  if (access.status === 'denied' || access.data === false) return fallback('no_access');
  if (access.data !== true) return fallback('unverified');
  return { screen: 'PetCareTask', params: { petId, taskId }, offline: access.status !== 'fresh' };
}
