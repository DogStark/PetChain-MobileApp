/* eslint-disable @typescript-eslint/no-require-imports */

// Load .env.<APP_ENV> via dotenv
const APP_ENV = process.env.APP_ENV ?? 'development';

require('dotenv').config({ path: `.env.${APP_ENV}` });

// Version codes: dev=1, staging=2, prod=3
const VERSION_CODE = { development: 1, staging: 2, production: 3 }[APP_ENV] ?? 1;
const APP_VERSION = '1.0.0';

const APP_NAME_MAP = {
  development: 'PetChain (Dev)',
  staging: 'PetChain (Staging)',
  production: 'PetChain',
};

// The runtimeVersion is what expo-updates uses (natively, before any JS runs) to decide
// whether a fetched OTA manifest is even eligible to apply to this binary. Embedding APP_ENV
// in it means a staging-published update's runtimeVersion ("staging-1.0.0") can never satisfy
// a production binary's runtimeVersion ("production-1.0.0"), even if a channel/URL were
// misconfigured — the native layer rejects the manifest outright. See issue #991.
const RUNTIME_VERSION = `${APP_ENV}-${APP_VERSION}`;

// RTL test locale fixture (issue #1052).
//
// Arabic and Hebrew are the RTL locales we ship translations for. The app must not
// flip direction mid-session: I18nManager.forceRTL/allowRTL only take effect after a
// full reload, so direction is decided here (natively, before any JS runs) and the
// runtime only ever *reads* it. `extra.RTL_TEST_LOCALE` lets the Maestro smoke flow
// and component snapshots boot the app in an RTL fixture locale without touching
// persisted user preferences.
const RTL_TEST_LOCALE = process.env.RTL_TEST_LOCALE ?? null;
const RTL_LOCALES = ['ar', 'he'];
const IS_RTL_TEST = RTL_TEST_LOCALE != null && RTL_LOCALES.includes(RTL_TEST_LOCALE);

// ─── Build provenance & runtime diagnostics (issue #1064) ──────────────────
//
// Support needs to distinguish development / preview / staging / production
// builds and identify the exact commit behind an installed binary. All values
// are derived from EAS configuration (eas.json profiles + EAS-injected env)
// rather than hand-maintained strings, so they cannot drift from the build that
// actually shipped.
//
// EAS injects the following at build time:
//   EAS_BUILD_PROFILE      — the eas.json profile name (e.g. "production")
//   EAS_BUILD_GIT_COMMIT_HASH — the commit the binary was built from
//   EAS_BUILD_ID           — the unique EAS build identifier
//   EAS_BUILD_CHANNEL      — the release channel the build publishes to
//
// The diagnostics view is gated behind support/debug access (see
// `extra.diagnostics.requiresSupportAccess`); it is never shown to end users.
// Every field is redacted: only the *origin* of the API base URL is exposed
// (never credentials, query strings, or paths), and no user content is read.
const EAS_BUILD_PROFILE = process.env.EAS_BUILD_PROFILE ?? APP_ENV;
const EAS_BUILD_GIT_COMMIT_HASH = process.env.EAS_BUILD_GIT_COMMIT_HASH ?? null;
const EAS_BUILD_ID = process.env.EAS_BUILD_ID ?? null;
const EAS_BUILD_CHANNEL = process.env.EAS_BUILD_CHANNEL ?? APP_ENV;

// Release channel per EAS profile. Kept in sync with eas.json `channel`.
const RELEASE_CHANNEL_MAP = {
  development: 'development',
  preview: 'preview',
  staging: 'staging',
  production: 'production',
};
const RELEASE_CHANNEL = RELEASE_CHANNEL_MAP[EAS_BUILD_PROFILE] ?? EAS_BUILD_CHANNEL;

// Required provenance fields. CI (scripts/verifyBuildProvenance.js) fails a
// release build when any of these are missing, so a shipped binary can always
// be traced back to a commit and a channel.
const REQUIRED_PROVENANCE_FIELDS = ['appVersion', 'buildNumber', 'environment', 'releaseChannel', 'commit'];

// Redact a URL down to its origin only. Credentials, query strings, and paths
// are stripped so the diagnostics view can never leak secrets or user content.
function redactUrlOrigin(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

// Feature-flag snapshot. Only flag *names* and their boolean state are exposed;
// no flag values that could carry user data or secrets.
const FEATURE_FLAGS = {
  ocrReview: process.env.EXPO_PUBLIC_FLAG_OCR_REVIEW === 'true',
  backupImport: process.env.EXPO_PUBLIC_FLAG_BACKUP_IMPORT === 'true',
  androidNotificationChannels: process.env.EXPO_PUBLIC_FLAG_ANDROID_NOTIFICATION_CHANNELS === 'true',
};

const DIAGNOSTICS = {
  // Gated behind support/debug access only.
  requiresSupportAccess: true,
  appVersion: APP_VERSION,
  buildNumber: String(VERSION_CODE),
  environment: APP_ENV,
  releaseChannel: RELEASE_CHANNEL,
  commit: EAS_BUILD_GIT_COMMIT_HASH,
  buildId: EAS_BUILD_ID,
  apiBaseUrlOrigin: redactUrlOrigin(process.env.EXPO_PUBLIC_API_BASE_URL),
  featureFlags: FEATURE_FLAGS,
  requiredFields: REQUIRED_PROVENANCE_FIELDS,
};

// ─── Deep / universal link policy (issue #1029) ─────────────────────────────
//
// Supported link routes and their parameter schemas are documented here in one
// central place. The native layer only ever *routes* a link to the app; the JS
// layer must validate every incoming link against this schema before acting on
// it (see the deep-link validator). Keeping the schema next to the native
// associatedDomains / intentFilters config ensures the two never drift.
//
// Each route declares:
//   path        — the URL path (matched exactly, no wildcards)
//   params      — allowed query params and their expected type
//   requiresAuth— whether the route may only be opened by an authenticated user
//   mutating    — whether opening the route can trigger a state mutation
//
// Security invariants enforced by the validator:
//   • Untrusted links cannot bypass authentication (requiresAuth routes are
//     rejected for logged-out users and replayed after sign-in).
//   • Untrusted links cannot change accounts (no account/identity params are
//     accepted from a link; the active session is never switched by a link).
//   • Untrusted links cannot trigger mutations (mutating routes require an
//     explicit in-app confirmation and a valid, unexpired signed token).
//   • Links expire or fail safely when their resource is revoked (every
//     resource-scoped route carries an `exp` and is re-checked server-side;
//     revoked/expired links resolve to a safe fallback, never a mutation).
const DEEP_LINK_ROUTES = {
  '/pet': {
    params: { id: 'string' },
    requiresAuth: true,
    mutating: false,
  },
  '/record': {
    params: { id: 'string', exp: 'number' },
    requiresAuth: true,
    mutating: false,
  },
  '/share': {
    params: { token: 'string', exp: 'number' },
    requiresAuth: false,
    mutating: false,
  },
  '/sos': {
    params: { id: 'string', exp: 'number' },
    requiresAuth: true,
    mutating: false,
  },
  '/invite': {
    params: { token: 'string', exp: 'number' },
    requiresAuth: false,
    mutating: true,
  },
};

// Hosts that are allowed to deep-link into the app. Anything else is treated as
// untrusted and must not be routed.
const DEEP_LINK_ALLOWED_HOSTS = ['petchain.app', 'www.petchain.app'];

// ─── Sensitive-screen snapshot protection (issue #1036) ─────────────────────
//
// Medical records, wallet secrets, and emergency details must never appear in
// OS task-switcher snapshots or screenshots. The JS layer applies per-screen
// protection (iOS: a blur/overlay view while backgrounded; Android:
// FLAG_SECURE via the native module), but the native manifest must also opt in
// so protection is active from the very first frame — before any JS runs — and
// so navigation transitions cannot briefly expose protected content.
//
// Android: android:excludeFromRecents is intentionally NOT set globally (that
// would hide the whole app from the switcher, breaking public QR verification
// flows). Instead the native module toggles FLAG_SECURE per sensitive screen.
// The manifest only declares the permission the module needs to read the
// current window state.
//
// iOS: the native module installs a snapshot-blur overlay on
// UIApplicationDidEnterBackgroundNotification and removes it on
// UIApplicationWillEnterForegroundNotification, so the switcher snapshot is
// always blurred for sensitive screens. No Info.plist key is required, but we
// keep the flag here so the JS layer and native layer agree on the policy.
const SENSITIVE_SCREEN_PROTECTION = {
  // Screens that must apply snapshot protection while foregrounded/backgrounded.
  // Public QR verification screens are deliberately excluded so they remain
  // usable and unprotected.
  protectedRoutes: ['/records', '/wallet', '/emergency'],
  // Routes that must remain unprotected (public QR verification).
  publicRoutes: ['/verify', '/share'],
  // iOS: blur overlay applied on backgrounding.
  ios: { blurOnBackground: true },
  // Android: FLAG_SECURE applied per sensitive screen.
  android: { flagSecure: true },
};

// ─── Release checklist (issue #1094) ───────────────────────────────────────
//
// Single source of truth for the artifacts a production build must ship:
// store screenshots, app icons, splash art, legal documents, and release notes.
// `scripts/verifyReleaseChecklist.js` reads this block in CI and fails a
// production build with the *named* missing artifact. Preview/staging builds
// may fall back to the documented placeholders below.
const RELEASE_CHECKLIST = {
  // Required store screenshots (per platform) and their expected dimensions.
  screenshots: {
    ios: [
      { path: './assets/store/screenshots/ios/6.7-inch.png', width: 1290, height: 2796 },
      { path: './assets/store/screenshots/ios/6.5-inch.png', width: 1242, height: 2688 },
    ],
    android: [
      { path: './assets/store/screenshots/android/phone.png', width: 1080, height: 1920 },
    ],
  },
  // Required icon + splash assets and their expected dimensions.
  icons: [
    { path: './assets/icon.png', width: 1024, height: 1024 },
    { path: './assets/adaptive-icon.png', width: 1024, height: 1024 },
  ],
  splash: [{ path: './assets/splash.png', width: 1284, height: 2778 }],
  // Legal documents that must exist and be wired to an HTTPS, env-specific URL.
  legal: [
    { name: 'privacyPolicy', file: './legal/privacy-policy.md', urlEnv: 'EXPO_PUBLIC_PRIVACY_POLICY_URL' },
    { name: 'termsOfService', file: './legal/terms-of-service.md', urlEnv: 'EXPO_PUBLIC_TERMS_OF_SERVICE_URL' },
  ],
  // Release notes must be present for production builds.
  releaseNotes: { path: './RELEASE_NOTES.md' },
  // Documented placeholders preview/staging builds may use instead of real assets.
  placeholders: {
    screenshots: './assets/store/screenshots/placeholder.png',
    icon: './assets/icon.png',
    splash: './assets/splash.png',
  },
};

// Resolve a legal document URL for the current environment. Production must be
// an explicit HTTPS URL; non-production environments may fall back to the
// documented placeholder host so preview builds keep working.
function resolveLegalUrl(urlEnv) {
  const configured = process.env[urlEnv];
  if (configured) {
    return configured;
  }
  if (APP_ENV === 'production') {
    // Leave undefined so the release validator fails wit

/* … truncated 12271 chars — edit only what you need near the top … */
