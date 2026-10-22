/**
 * Security headers middleware.
 *
 * Configures Helmet.js with a strict Content Security Policy, HSTS with
 * preload, and complementary headers that harden the Express API against
 * common web-layer attacks (XSS, clickjacking, MIME-sniffing, etc.).
 *
 * Usage:
 *   import { applySecurityHeaders } from '../middleware/securityHeaders';
 *   applySecurityHeaders(app);
 */

import type { Express } from 'express';
import helmet from 'helmet';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Whitelist of trusted origins for CSP `connect-src`.
 * Extend via the ALLOWED_ORIGINS env var (comma-separated).
 */
const TRUSTED_ORIGINS: string[] = [
  "'self'",
  'https://api.petchain.app',
  'https://staging.petchain.app',
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : []),
];

/**
 * Applies all security headers to the Express application.
 *
 * - Helmet core headers (X-Frame-Options, X-Content-Type-Options, etc.)
 * - Strict Content Security Policy
 * - HSTS with 1-year max-age and preload (production only)
 */
export function applySecurityHeaders(app: Express): void {
  // --- Basic Helmet headers (no CSP yet — we configure it separately) ---
  app.use(
    helmet({
      contentSecurityPolicy: false, // overridden below
      crossOriginEmbedderPolicy: IS_PROD,
      hsts: IS_PROD
        ? {
            maxAge: 31_536_000, // 1 year in seconds
            includeSubDomains: true,
            preload: true,
          }
        : false,
    }),
  );

  // --- Strict Content Security Policy ---
  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles needed by Swagger UI
        imgSrc: ["'self'", 'data:', 'https://cdn.petchain.app'],
        fontSrc: ["'self'"],
        connectSrc: TRUSTED_ORIGINS,
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    }),
  );

  // Prevent browsers from guessing MIME types
  app.use(helmet.noSniff());

  // Disable X-Powered-By header
  app.disable('x-powered-by');

  // Referrer policy — do not leak origin to third parties
  app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

  // Permissions policy — restrict browser feature access
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
}

/**
 * Field-level whitelist validators.
 *
 * Use these in route handlers to enforce strict input shapes before
 * passing values to the database layer.
 */
export const inputWhitelist = {
  /** Alphanumeric + common punctuation, max 200 chars */
  name: /^[\w\s\-'.]{1,200}$/,
  /** RFC-5321 e-mail (simplified) */
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  /** UUID v4 */
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /** ISO-8601 date (YYYY-MM-DD) */
  date: /^\d{4}-\d{2}-\d{2}$/,
  /** Positive integer strings */
  positiveInt: /^\d{1,10}$/,
  /** Alphanumeric + underscore + hyphen identifiers */
  identifier: /^[\w-]{1,100}$/,
} as const;

/**
 * Returns true when the value passes the named whitelist rule.
 */
export function isWhitelisted(rule: keyof typeof inputWhitelist, value: string): boolean {
  return inputWhitelist[rule].test(value);
}
