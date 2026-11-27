import type { NextFunction, Request, Response } from 'express';

/**
 * Minimum API version the backend will accept.
 * Requests with X-API-Version below this are rejected with 410 Gone.
 */
const MINIMUM_VERSION = '2.0';

/** Versions the API currently serves. */
export const SUPPORTED_VERSIONS = ['1', '2'] as const;
export type ApiVersion = (typeof SUPPORTED_VERSIONS)[number];

/** Version used when the client does not send Accept-Version. */
export const DEFAULT_VERSION: ApiVersion = '2';

/** Sunset date advertised for deprecated (v1) endpoints. */
export const SUNSET_DATE = 'Mon, 01 Dec 2026 00:00:00 GMT';

/** Header carrying the negotiated API version on every response. */
export const VERSION_HEADER = 'X-API-Version';

/**
 * Normalise an Accept-Version value ("1", "v1", "1.0") to a supported major
 * version, or undefined when it is not supported.
 */
export function negotiateVersion(raw: string | undefined): ApiVersion | undefined {
  if (!raw) return undefined;
  const major = raw.trim().replace(/^v/i, '').split('.')[0];
  return (SUPPORTED_VERSIONS as readonly string[]).includes(major)
    ? (major as ApiVersion)
    : undefined;
}

/**
 * Accept-Version negotiation middleware.
 *
 * - Reads the `Accept-Version` header (falls back to `X-API-Version`).
 * - Attaches the negotiated version to `req.apiVersion` and echoes it back in
 *   the `X-API-Version` response header.
 * - Responds 406 Not Acceptable when the requested version is unsupported.
 */
export function apiVersionNegotiation(req: Request, res: Response, next: NextFunction): void {
  const raw =
    (req.headers['accept-version'] as string | undefined) ??
    (req.headers['x-api-version'] as string | undefined);

  const version = raw === undefined ? DEFAULT_VERSION : negotiateVersion(raw);

  if (!version) {
    res.status(406).json({
      error: 'api_version_not_acceptable',
      supportedVersions: SUPPORTED_VERSIONS,
      message: `API version ${raw} is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}.`,
    });
    return;
  }

  (req as Request & { apiVersion?: ApiVersion }).apiVersion = version;
  res.setHeader(VERSION_HEADER, version);
  next();
}

/**
 * Deprecation middleware for sunset endpoints.
 *
 * Sets `X-API-Deprecated: true` plus `X-Sunset-Date` (and the RFC 8594
 * `Deprecation` / `Sunset` / `Link` headers) on responses served by a
 * deprecated route. Mount it on the deprecated router only.
 */
export function markDeprecated(sunsetDate: string = SUNSET_DATE) {
  return function deprecationNotice(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-API-Deprecated', 'true');
    res.setHeader('X-Sunset-Date', sunsetDate);
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', sunsetDate);
    res.setHeader(
      'Link',
      '</api/v2>; rel="successor-version", </api/docs/migration-v1-to-v2.md>; rel="deprecation"',
    );
    next();
  };
}

/**
 * Parse a "major.minor" version string into a comparable tuple.
 * Non-numeric segments default to 0.
 */
function parseVersion(v: string): [number, number] {
  const [major = 0, minor = 0] = v.split('.').map(Number);
  return [Number.isFinite(major) ? major : 0, Number.isFinite(minor) ? minor : 0];
}

/** Returns true when `version` is strictly below `minimum`. */
function isBelowMinimum(version: string, minimum: string): boolean {
  const [maj, min] = parseVersion(version);
  const [minMaj, minMin] = parseVersion(minimum);
  return maj < minMaj || (maj === minMaj && min < minMin);
}

/**
 * API version enforcement middleware.
 *
 * - Reads the X-API-Version request header.
 * - If the header is missing or the version is below MINIMUM_VERSION, responds
 *   with 410 Gone so the client knows it must upgrade.
 * - For requests that carry a supported version, attaches RFC 8594
 *   Deprecation + Sunset headers for versions that are deprecated but still
 *   served (currently: any v2.x while v1 is sunsetted).
 */
export function deprecationHeaders(req: Request, res: Response, next: NextFunction): void {
  const clientVersion = req.headers['x-api-version'] as string | undefined;

  if (!clientVersion || isBelowMinimum(clientVersion, MINIMUM_VERSION)) {
    res.status(410).json({
      error: 'api_version_unsupported',
      minimumVersion: MINIMUM_VERSION,
      message:
        `API version ${clientVersion ?? '(none)'} is no longer supported. ` +
        `Please upgrade to v${MINIMUM_VERSION} or later.`,
      docsUrl: '/api/docs/migration-v1-to-v2.md',
    });
    return;
  }

  // Attach deprecation notice for v2 responses while v3 is in development
  res.setHeader('Deprecation', 'false');
  res.setHeader('Sunset', SUNSET_DATE);
  res.setHeader(
    'Link',
    '</api/v2>; rel="successor-version", </api/docs/migration-v1-to-v2.md>; rel="deprecation"',
  );

  next();
}
