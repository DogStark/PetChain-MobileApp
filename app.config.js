/* eslint-disable @typescript-eslint/no-require-imports */

// Load .env.<APP_ENV> via dotenv
const APP_ENV = process.env.APP_ENV ?? 'development';

require('dotenv').config({ path: `.env.${APP_ENV}` });

// ─── Startup configuration schema validation (issue #1069) ─────────────────
//
// A malformed `.env` or EAS configuration must fail loudly at startup with a
// *named* configuration error, rather than surfacing later as an opaque API or
// blockchain failure. Values are validated against typed schemas below and are
// classified as either PUBLIC configuration (safe to embed in the client
// bundle and render) or SECRET (never rendered or logged).
//
// Secrets are only ever checked for *presence*; their values are never read
// into any returned/rendered structure, so they cannot leak into logs, error
// messages, or the app manifest.
const CONFIG_PROFILES = ['development', 'staging', 'production'];

// Typed schema for each configuration value.
//   kind: 'public' | 'secret'
//   type: 'string' | 'url' | 'number' | 'boolean'
//   required: profiles in which the value must be present
//   pattern: optional validation regex (applied to public values only)
const CONFIG_SCHEMA = {
  EXPO_PUBLIC_API_URL: {
    kind: 'public',
    type: 'url',
    required: ['development', 'staging', 'production'],
  },
  EXPO_PUBLIC_CHAIN_ID: {
    kind: 'public',
    type: 'number',
    required: ['development', 'staging', 'production'],
  },
  EXPO_PUBLIC_PRIVACY_POLICY_URL: {
    kind: 'public',
    type: 'url',
    required: ['production'],
  },
  EXPO_PUBLIC_TERMS_OF_SERVICE_URL: {
    kind: 'public',
    type: 'url',
    required: ['production'],
  },
  EXPO_PUBLIC_ENABLE_ANALYTICS: {
    kind: 'public',
    type: 'boolean',
    required: [],
  },
  // Secrets: presence-checked only, never read into rendered output.
  API_SECRET_KEY: {
    kind: 'secret',
    type: 'string',
    required: ['staging', 'production'],
  },
  BLOCKCHAIN_SIGNER_KEY: {
    kind: 'secret',
    type: 'string',
    required: ['staging', 'production'],
  },
};

// Named configuration error. The message identifies the offending key and the
// profile, but never includes a value (so secrets cannot leak).
class ConfigurationError extends Error {
  constructor(key, profile, reason) {
    super(`ConfigurationError: ${key} is invalid for profile "${profile}" (${reason})`);
    this.name = 'ConfigurationError';
    this.key = key;
    this.profile = profile;
  }
}

function validateConfigValue(key, spec, profile) {
  const raw = process.env[key];
  const isRequired = spec.required.includes(profile);

  if (raw == null || raw === '') {
    if (isRequired) {
      throw new ConfigurationError(key, profile, 'missing required value');
    }
    return undefined;
  }

  // Secrets are validated for presence only; never parse or expose the value.
  if (spec.kind === 'secret') {
    return undefined;
  }

  switch (spec.type) {
    case 'number': {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new ConfigurationError(key, profile, 'expected a number');
      }
      return parsed;
    }
    case 'boolean': {
      if (raw !== 'true' && raw !== 'false') {
        throw new ConfigurationError(key, profile, 'expected "true" or "false"');
      }
      return raw === 'true';
    }
    case 'url': {
      let parsed;
      try {
        parsed = new URL(raw);
      } catch {
        throw new ConfigurationError(key, profile, 'expected a valid URL');
      }
      if (parsed.protocol !== 'https:' && profile === 'production') {
        throw new ConfigurationError(key, profile, 'production URLs must use https');
      }
      return raw;
    }
    case 'string':
    default:
      return raw;
  }
}

// Validate the whole schema for a profile. Returns only PUBLIC values so the
// result is safe to embed in the manifest and render; secrets are omitted.
function validateConfig(profile) {
  if (!CONFIG_PROFILES.includes(profile)) {
    throw new ConfigurationError('APP_ENV', profile, 'unknown profile');
  }
  const publicConfig = {};
  for (const [key, spec] of Object.entries(CONFIG_SCHEMA)) {
    const value = validateConfigValue(key, spec, profile);
    if (spec.kind === 'public' && value !== undefined) {
      publicConfig[key] = value;
    }
  }
  return publicConfig;
}

// Fail fast at startup with a named configuration error.
const PUBLIC_CONFIG = validateConfig(APP_ENV);

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

// ─── App-update migration rollback handling (issue #1057) ───────────────────
//
// A failed local schema or persisted-state migration can leave the app unable to
// start after an upgrade. The runtime migration runner (see the migration service)
// needs a deterministic, all-or-nothing contract so a crash mid-migration is
// detected on the next launch and recovered without ever silently deleting health
// records. This block is the single source of truth for that contract; the native
// layer reads `extra.MIGRATION_POLICY` before any JS runs so the recovery path is
// active from the very first frame.
//
// Contract:
//   • Migrations are atomic from the user's perspective: a checkpoint is written
//     before each phase and the failed-migration marker is only cleared once the
//     whole migration commits. A marker left behind means the previous run crashed.
//   • On the next launch, a leftover marker (or a checkpoint that never committed)
//     is treated as a crash and triggers recovery.
//   • Recovery restores the last known-good database snapshot. If no snapshot is
//     available it quarantines ONLY the incompatible record — health records are
//     never silently deleted.
//   • The app surfaces migration version, app version, and a non-sensitive support
//     code instead of raw database errors.
const MIGRATION_POLICY = {
  // Bump when the persisted-state schema changes so the runner knows a migration
  // is required and can record which version was being applied.
  schemaVersion: 1,
  // Ordered phases a migration passes through. A checkpoint is persisted before
  // each phase; a crash between phases is detected on the next launch.
  phases: ['prepare', 'snapshot', 'apply', 'verify', 'commit'],
  // Marker key written before a migration starts and cleared only after commit.
  // A leftover marker on launch means the previous run crashed mid-migration.
  failedMarkerKey: 'petchain.migration.failed',
  // Checkpoint key holding the last phase that completed successfully.
  checkpointKey: 'petchain.migration.checkpoint',
  // Key holding the last known-good database snapshot used for recovery.
  snapshotKey: 'petchain.migration.snapshot',
  // Recovery strategy order. `restoreSnapshot` is preferred; `quarantineRecord`
  // is the fallback and only ever isolates the incompatible record.
  recovery: {
    strategy: ['restoreSnapshot', 'quarantineRecord'],
    // Health records must never be silently deleted during recovery.
    deleteHealthRecords: false,
  },
  // Non-sensitive support code surfaced to the user instead of raw DB errors.
  // The runtime appends the migration version and app version to this prefix.
  supportCodePrefix: 'MIG',

// ─── Android notification-channel policy (issue #1066) ─────────────────────
//
// Android notification channels persist outside the app: once created, a
// channel's id, importance, and visibility survive app upgrades and even
// uninstall/reinstall. That makes channel ids a *contract* — they must be
// stable across releases, and a retired channel id must never be reused for a
// different purpose (users would silently inherit the old channel's settings).
//
// This block is the single source of truth for channel ids, their policy, and
// the migration rules the JS layer applies on startup. The JS layer reads
// `extra.notificationChannels` and reconciles the device's channels against it
// (see the notification-channel manager).
//
// Rules:
//   • `id` is immutable. Renaming a channel means creating a NEW id and
//     retiring the old one via `deprecated` — never editing an existing id.
//   • `deprecated` channels are deleted on upgrade and their id is tombstoned
//     in `retiredChannelIds` so it can never be reused for another purpose.
//   • `sensitive: true` channels default to IMPORTANCE_LOW + VISIBILITY_SECRET
//     so medication/appointment/SOS previews are hidden on the lock screen
//     unless the user explicitly opts in.
//   • `reminderType` links each reminder kind to exactly one documented channel.
const NOTIFICATION_CHANNEL_POLICY_VERSION = 1;

const NOTIFICATION_CHANNELS = [
  {
    id: 'medication-reminders-v1',
    name: 'Medication reminders',
    description: 'Dose reminders for your pets.',
    reminderType: 'medication',
    importance: 'high',
    // Medication names are health data — hide previews by default.
    sensitive: true,
    visibility: 'secret',
    deprecated: false,
  },
  {
    id: 'appointment-reminders-v1',
    name: 'Appointment reminders',
    description: 'Upcoming vet visits and appointments.',
    reminderType: 'appointment',
    importance: 'default',
    // Appointment details can reveal location/health context — hide by default.
    sensitive: true,
    visibility: 'secret',
    deprecated: false,
  },
  {
    id: 'sos-alerts-v1',
    name: 'Emergency (SOS) alerts',
    description: 'Critical emergency alerts for your pets.',
    reminderType: 'sos',
    importance: 'max',
    // SOS payloads carry location/identity — never preview on the lock screen.
    sensitive: true,
    visibility: 'secret',
    deprecated: false,
  },
  {
    id: 'general-updates-v1',
    name: 'General updates',
    description: 'Non-urgent app updates and tips.',
    reminderType: 'general',
    importance: 'low',
    sensitive: false,
    visibility: 'private',
    deprecated: false,
  },
];

// Channel ids that have been retired. Tombstoned so a future channel can never
// reuse one of these ids for a different purpose (acceptance criterion:
// "Deprecated channels are not reused for a different purpose").
const RETIRED_CHANNEL_IDS = [];

// Migration rules applied on startup, in order. Each rule is declarative so the
// JS manager can execute it deterministically and unit-test it in isolation.
const NOTIFICATION_CHANNEL_MIGRATIONS = [
  {
    // v0 → v1: no channels existed before this policy; nothing to migrate.
    from: 0,
    to: 1,
    actions: [],
  },
];

// Disabled-channel UX policy. When the user has turned a channel off in system
// settings we surface a single explanatory state; we must not repeatedly prompt.
const NOTIFICATION_CHANNEL_DISABLED_UX = {
  // Show the explanation at most once per channel per policy version.
  promptOncePerVersion: true,
  // Never re-prompt within this window even if the user reopens the app.
  minRepromptIntervalMs: 7 * 24 * 60 * 60 * 1000,
  // Deep-link target for the system channel settings screen.
  settingsRoute: 'app-settings',
};

const NOTIFICATION_CHANNEL_POLICY = {
  version: NOTIFICATION_CHANNEL_POLICY_VERSION,
  channels: NOTIFICATION_CHANNELS,
  retiredChannelIds: RETIRED_CHANNEL_IDS,
  migrations: NOTIFICATION_CHANNEL_MIGRATIONS,
  disabledUx: NOTIFICATION_CHANNEL_DISABLED_UX,
};
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
// UIAppl

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
    // Leave undefined so the release validator fails with a named error.
    return undefined;
  }
  return `https://${APP_ENV}.petchain.app/legal`;
}

module.exports = {
  expo: {
    name: APP_NAME_MAP[APP_ENV] ?? APP_NAME_MAP.development,
    slug: 'petchain',
    version: APP_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'petchain',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'app.petchain.mobile',
      associatedDomains: DEEP_LINK_ALLOWED_HOSTS.map((host) => `applinks:${host}`),
    },
    android: {
      package: 'app.petchain.mobile',
      versionCode: VERSION_CODE,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: DEEP_LINK_ALLOWED_HOSTS.map((host) => ({ scheme: 'https', host })),
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      appEnv: APP_ENV,
      // Public configuration only — secrets are never embedded here.
      publicConfig: PUBLIC_CONFIG,
      deepLinkRoutes: DEEP_LINK_ROUTES,
      deepLinkAllowedHosts: DEEP_LINK_ALLOWED_HOSTS,
      sensitiveScreenProtection: SENSITIVE_SCREEN_PROTECTION,
      releaseChecklist: RELEASE_CHECKLIST,
      migrationPolicy: MIGRATION_POLICY,
      rtlTestLocale: IS_RTL_TEST ? RTL_TEST_LOCALE : null,
      legalUrls: {
        privacyPolicy: resolveLegalUrl('EXPO_PUBLIC_PRIVACY_POLICY_URL'),
        termsOfService: resolveLegalUrl('EXPO_PUBLIC_TERMS_OF_SERVICE_URL'),
      },
    },
  },
};
