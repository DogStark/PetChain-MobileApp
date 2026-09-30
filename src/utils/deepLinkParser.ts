/**
 * Parses and handles deep links for QR code scans and external navigation.
 * Supports both custom scheme links (petchain://) and universal links
 * (https://petchain.app/...).
 */

export type DeepLinkType =
  | 'pet-profile'
  | 'appointment'
  | 'medical-record'
  | 'qr-scan'
  | 'unknown';

export interface ParsedDeepLink {
  type: DeepLinkType;
  path: string;
  params: Record<string, string>;
  raw: string;
}

const CUSTOM_SCHEME = 'petchain://';
const UNIVERSAL_HOSTS = ['petchain.app', 'www.petchain.app'];

const ROUTE_TYPE_MAP: Record<string, DeepLinkType> = {
  pet: 'pet-profile',
  appointment: 'appointment',
  'medical-record': 'medical-record',
  qr: 'qr-scan',
};

function stripToPathAndQuery(url: string): string {
  if (url.startsWith(CUSTOM_SCHEME)) {
    return url.slice(CUSTOM_SCHEME.length);
  }

  for (const host of UNIVERSAL_HOSTS) {
    const prefix = `https://${host}/`;
    if (url.startsWith(prefix)) {
      return url.slice(prefix.length);
    }
  }

  return url;
}

function parseQueryParams(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!query) return params;

  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }

  return params;
}

/**
 * Returns true if the given URL is a deep link this app understands
 * (either the custom scheme or one of the recognized universal link hosts).
 */
export function isAppDeepLink(url: string): boolean {
  if (!url) return false;
  if (url.startsWith(CUSTOM_SCHEME)) return true;
  return UNIVERSAL_HOSTS.some((host) => url.startsWith(`https://${host}/`));
}

/**
 * Parses a deep link URL (from a QR scan or external navigation event)
 * into a structured, routable representation.
 */
export function parseDeepLink(url: string): ParsedDeepLink {
  const trimmed = (url || '').trim();
  const [pathAndParams] = [stripToPathAndQuery(trimmed)];
  const [pathPart, queryPart = ''] = pathAndParams.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const rootSegment = segments[0] ?? '';

  return {
    type: ROUTE_TYPE_MAP[rootSegment] ?? 'unknown',
    path: pathPart,
    params: parseQueryParams(queryPart),
    raw: trimmed,
  };
}

/**
 * Convenience helper for handling a raw QR code payload, which may either
 * be a bare deep link or plain text (e.g. a pet ID).
 */
export function parseQrPayload(payload: string): ParsedDeepLink {
  if (isAppDeepLink(payload)) {
    return parseDeepLink(payload);
  }

  return {
    type: 'unknown',
    path: payload,
    params: {},
    raw: payload,
  };
}
