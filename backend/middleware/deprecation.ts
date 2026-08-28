import type { NextFunction, Request, Response } from 'express';

/**
 * Minimum API version the backend will accept.
 * Requests with X-API-Version below this are rejected with 410 Gone.
 */
const MINIMUM_VERSION = '2.0';

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
  res.setHeader('Sunset', 'Mon, 01 Dec 2026 00:00:00 GMT');
  res.setHeader(
    'Link',
    '</api/v2>; rel="successor-version", </api/docs/migration-v1-to-v2.md>; rel="deprecation"',
  );

  next();
}
