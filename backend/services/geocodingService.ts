/**
 * Address geocoding for vet clinic locations (#1396).
 *
 * Provider selection:
 *  - GOOGLE_GEOCODING_API_KEY set → Google Geocoding API
 *  - otherwise                    → OpenStreetMap Nominatim
 *    (GEOCODING_USER_AGENT identifies the app, as Nominatim's policy requires)
 */

import logger from '../utils/logger';

export interface Coordinates {
  lat: number;
  lng: number;
}

export type Geocoder = (address: string) => Promise<Coordinates | null>;

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

function toCoordinates(lat: unknown, lng: unknown): Coordinates | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

/** Creates a geocoder for the configured provider. */
export function createGeocoder(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = (globalThis.fetch as unknown as FetchLike),
): Geocoder {
  const googleKey = env.GOOGLE_GEOCODING_API_KEY;

  return async (address: string) => {
    const query = address.trim();
    if (!query) return null;
    try {
      if (googleKey) {
        const url =
          'https://maps.googleapis.com/maps/api/geocode/json?address=' +
          `${encodeURIComponent(query)}&key=${encodeURIComponent(googleKey)}`;
        const res = await fetchImpl(url);
        if (!res.ok) return null;
        const body = (await res.json()) as {
          results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
        };
        const loc = body.results?.[0]?.geometry?.location;
        return loc ? toCoordinates(loc.lat, loc.lng) : null;
      }

      const url =
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
        encodeURIComponent(query);
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': env.GEOCODING_USER_AGENT ?? 'PetChain-Backend' },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { lat?: string; lon?: string }[];
      const first = Array.isArray(body) ? body[0] : undefined;
      return first ? toCoordinates(first.lat, first.lon) : null;
    } catch (err) {
      logger.warn('[geocoding] Failed to geocode address', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };
}

let defaultGeocoder: Geocoder = createGeocoder();

/** Geocodes an address with the configured provider. */
export function geocodeAddress(address: string): Promise<Coordinates | null> {
  return defaultGeocoder(address);
}

/** Overrides the geocoder (used by tests and the backfill script). */
export function setGeocoder(geocoder: Geocoder): void {
  defaultGeocoder = geocoder;
}

export default { geocodeAddress, createGeocoder, setGeocoder };
