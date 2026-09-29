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
    // Leave undefined so the release validator fails with the named artifact.
    return undefined;
  }
  return `https://preview.petchain.app/legal/${urlEnv.toLowerCase()}`;
}

const LEGAL_URLS = RELEASE_CHECKLIST.legal.reduce((acc, doc) => {
  acc[doc.name] = resolveLegalUrl(doc.urlEnv);
  return acc;
}, {});

// ─── App-store privacy declarations (issue #1041) ──────────────────────────
//
// These declarations are versioned beside the release config so that CI can
// verify them against the shipped capabilities (permissions, plugins, and
// runtime data flows). The iOS privacy manifest (PrivacyInfo.xcprivacy) and
// the Android data-safety inputs live under `privacy/` and are referenced
// here so a single source of truth drives both the native build and the
// automated verification in `scripts/verifyPrivacyManifest.js`.
//
// Each entry maps a declared data type to the code path and runtime behavior
// that produces it. `requiredReasonAPIs` lists the Apple required-reason API
// categories the app actually calls; CI fails if a manifest omits one of
// these or if a permission is added without a matching declaration.
const PRIVACY_DECLARATIONS = {
  // iOS privacy manifest + Android data-safety inputs, versioned beside release config.
  iosManifestPath: './privacy/PrivacyInfo.xcprivacy',
  androidDataSafetyPath: './privacy/android-data-safety.json',
  // Apple required-reason API categories the app calls (must be declared in the manifest).
  requiredReasonAPIs: [
    'NSPrivacyAccessedAPICategoryUserDefaults',
    'NSPrivacyAccessedAPICategoryFileTimestamp',
    'NSPrivacyAccessedAPICategoryDiskSpace',
  ],
  // Declared data collection, mapped to code + runtime behavior.
  collectedDataTypes: [
    {
      type: 'NSPrivacyCollectedDataTypeCamera',
      androidType: 'Photos and videos',
      linked: true,
      tracking: false,
      purpose: 'QR scanning for pet identification and medical record sharing',
      code: 'src/screens/ScanScreen.tsx',
      runtime: 'Camera permission requested on scan screen mount',
    },
    {
      type: 'NSPrivacyCollectedDataTypePhotosorVideos',
      androidType: 'Photos and videos',
      linked: true,
      tracking: false,
      purpose: 'Pet profile photo upload',
      code: 'src/screens/PetProfileScreen.tsx',
      runtime: 'Photo library permission requested on profile edit',
    },
    {
      type: 'NSPrivacyCollectedDataTypeCoarseLocation',
      androidType: 'Location',
      linked: true,
      tracking: false,
      purpose: 'Emergency SOS location sharing',
      code: 'src/services/location.ts',
      runtime: 'Location permission requested when SOS is triggered',
    },
    {
      type: 'NSPrivacyCollectedDataTypePreciseLocation',
      androidType: 'Location',
      linked: true,
      tracking: false,
      purpose: 'Emergency SOS location sharing',
      code: 'src/services/location.ts',
      runtime: 'Location permission requested when SOS is triggered',
    },
    {
      type: 'NSPrivacyCollectedDataTypeHealth',
      androidType: 'Health and fitness',
      linked: true,
      tracking: false,
      purpose: 'Pet health records sync',
      code: 'src/services/health.ts',
      runtime: 'Health data read/write on record sync',
    },
    {
      type: 'NSPrivacyCollectedDataTypeDeviceID',
      androidType: 'Device or other IDs',
      linked: true,
      tracking: false,
      purpose: 'Push notification delivery',
      code: 'src/services/pushNotifications.ts',
      runtime: 'Push token registered on login',
    },
    {
      type: 'NSPrivacyCollectedDataTypeUserID',
      androidType: 'Personal info',
      linked: true,
      tracking: false,
      purpose: 'Account authentication',
      code: 'src/services/api.ts',
      runtime: 'Auth token attached to API requests',
    },
  ],
};

module.exports = {
  expo: {
    name: APP_NAME_MAP[APP_ENV] ?? 'PetChain',
    slug: 'petchain-mobile',
    scheme: 'petchain',
    version: APP_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    updates: {
      // Never let a dev client pull an OTA update — it always runs from the local bundler.
      enabled: APP_ENV !== 'development',
      // Don't silently run a stale cached bundle indefinitely if a check fails.
      fallbackToCacheTimeout: 0,
      checkAutomatically: 'ON_LOAD',
    },
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    // Release checklist consumed by scripts/verifyReleaseChecklist.js in CI (issue #1094).
    extra: {
      releaseChecklist: RELEASE_CHECKLIST,
      legalUrls: LEGAL_URLS,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier:
        APP_ENV === 'production' ? 'app.petchain.mobile' : `app.petchain.mobile.${APP_ENV}`,
      associatedDomains: ['applinks:petchain.app'],
      buildNumber: String(VERSION_CODE),
      infoPlist: {
        NSCameraUsageDescription:
          'PetChain needs camera access to scan QR codes for pet identification and medical record sharing.',
        NSPhotoLibraryUsageDescription:
          'PetChain needs photo library access to upload pictures of your pets for their profiles.',
        NSPhotoLibraryAddUsageDescription: 'PetChain saves photos you take to your pet profile.',
        NSLocationWhenInUseUsageDescription:
          'PetChain uses your location for the Emergency SOS feature to share your whereabouts with emergency contacts when you request help.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'PetChain uses your location for the Emergency SOS feature to share your whereabouts with emergency contacts when you request help.',
        NSUserTrackingUsageDescription: 'PetChain does not track you for advertising purposes.',
        NSFaceIDUsageDescription:
          "PetChain uses Face ID/Touch ID for secure biometric authentication to protect your pet's medical data.",
        UIBackgroundModes: ['location', 'background-fetch'],
      },
      // App Groups for widget data sharing
      appGroups: ['group.app.petchain.mobile'],
      // iOS privacy manifest (issue #1041) — versioned beside release config.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
        NSPrivacyCollectedDataTypes: PRIVACY_DECLARATIONS.collectedDataTypes.map((d) => ({
          NSPrivacyCollectedDataType: d.type,
          NSPrivacyCollectedDataTypeLinked: d.linked,
          NSPrivacyCollectedDataTypeTracking: d.tracking,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        })),
        NSPrivacyAccessedAPITypes: PRIVACY_DECLARATIONS.requiredReasonAPIs.map((api) => ({
          NSPrivacyAccessedAPIType: api,
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        })),
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#4A90A4',
      },
      package: APP_ENV === 'production' ? 'app.petchain.mobile' : `app.petchain.mobile.${APP_ENV}`,
      versionCode: VERSION_CODE,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: 'petchain.app', pathPrefix: '/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
      permissions: [
        'CAMERA',
      

/* … truncated 4161 chars — edit only what you need near the top … */
