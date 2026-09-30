import * as Linking from 'expo-linking';
import { getSession } from '../services/authService';

export type ParsedDeepLink =
  | { route: 'PetDetail'; params: { petId: string } }
  | { route: 'Appointments'; params: { appointmentId: string } }
  | { route: 'Emergency'; params: { sosId: string } };

const TRUSTED_HTTPS_HOST = 'petchain.app';
const APP_SCHEMES = new Set(['petchain', 'petchainapp']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
let pendingAuthenticatedLink: ParsedDeepLink | null = null;

/** Only documented, account-scoped destinations may be opened from external input. */
export function parseDeepLink(url: string): ParsedDeepLink | null {
  let authority: URL;
  let parsed: ReturnType<typeof Linking.parse>;
  try {
    authority = new URL(url);
    parsed = Linking.parse(url);
  } catch {
    return null;
  }

  const scheme = parsed.scheme?.toLowerCase();
  if (authority.username || authority.password || authority.port || authority.search || authority.hash)
    return null;
  let path = parsed.path ?? '';
  if (scheme === 'https') {
    if (parsed.hostname?.toLowerCase() !== TRUSTED_HTTPS_HOST) return null;
  } else if (scheme && APP_SCHEMES.has(scheme)) {
    if (parsed.hostname) path = `${parsed.hostname}/${path}`;
  } else {
    return null;
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 2 && segments[0] === 'pets' && SAFE_ID.test(segments[1])) {
    return { route: 'PetDetail', params: { petId: segments[1] } };
  }
  if (
    segments.length === 2 &&
    segments[0] === 'appointments' &&
    SAFE_ID.test(segments[1])
  ) {
    return { route: 'Appointments', params: { appointmentId: segments[1] } };
  }
  if (segments.length === 2 && segments[0] === 'sos' && SAFE_ID.test(segments[1])) {
    return { route: 'Emergency', params: { sosId: segments[1] } };
  }

  return null;
}

export async function gateDeepLinkURL(url: string): Promise<string> {
  const parsed = parseDeepLink(url);
  if (!parsed) return 'petchain://invalid-link';

  try {
    if (await getSession()) return url;
  } catch {
    // Treat unreadable or expired sessions as unauthenticated.
  }

  pendingAuthenticatedLink = parsed;
  return 'petchain://auth';
}

export function takePendingAuthenticatedLink(): ParsedDeepLink | null {
  const pending = pendingAuthenticatedLink;
  pendingAuthenticatedLink = null;
  return pending;
}

