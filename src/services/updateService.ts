import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

declare const __DEV__: boolean;

export type UpdateStatus =
  | { type: 'up-to-date' }
  | { type: 'ota-available'; manifest: unknown }
  | { type: 'force-update'; storeUrl: string }
  | { type: 'error'; message: string };

const extra = Constants.expoConfig?.extra ?? {};
const APP_ENV: string = extra.APP_ENV ?? 'development';

// Minimum supported native build version per platform.
// Bump these when a native-only change requires a store update.
const MIN_NATIVE_VERSION = {
  ios: extra.MIN_NATIVE_VERSION_IOS ?? '1.0.0',
  android: extra.MIN_NATIVE_VERSION_ANDROID ?? '1.0.0',
};

const STORE_URLS = {
  ios: extra.IOS_STORE_URL ?? 'https://apps.apple.com/app/petchain/id000000000',
  android:
    extra.ANDROID_STORE_URL ?? 'https://play.google.com/store/apps/details?id=app.petchain.mobile',
};

// Each environment is only ever built and published with one EAS Update channel
// (see eas.json). expo-updates already refuses, at the native layer, to apply a manifest
// whose runtimeVersion doesn't match the running binary's — but that protection is only as
// strong as the runtimeVersion policy actually being set (see app.config.js). These checks
// are a JS-level second line of defense: if the running build's channel/runtimeVersion don't
// look like they belong to this APP_ENV, refuse to check for or apply any OTA update at all,
// rather than trusting a single layer to catch a staging/production mix-up (issue #991).
const EXPECTED_CHANNEL_BY_ENV: Record<string, string> = {
  staging: 'staging',
  production: 'production',
};

/**
 * True if the currently-running binary's channel/runtimeVersion are consistent with the
 * environment this JS bundle believes it's running in. False means something is wrong enough
 * that OTA updates should not be trusted (e.g. a staging build somehow running production
 * config, or vice versa).
 */
export function isUpdateBoundaryTrusted(): boolean {
  const expectedChannel = EXPECTED_CHANNEL_BY_ENV[APP_ENV];
  if (!expectedChannel) {
    // Development / preview builds aren't channel-pinned — nothing to cross-check.
    return true;
  }

  const runningChannel = Updates.channel;
  if (!runningChannel) {
    // No channel info available (e.g. bare workflow, dev client) — don't block on it.
    return true;
  }

  return runningChannel === expectedChannel;
}

/**
 * True if a fetched manifest's runtimeVersion matches the runtimeVersion of the binary
 * currently running. This should always be true by construction (expo-updates won't offer
 * a mismatched manifest), but is re-verified here so a bug or misconfiguration upstream
 * can never result in applying an incompatible update.
 */
function isManifestRuntimeCompatible(manifest: unknown): boolean {
  const manifestRuntimeVersion = (manifest as { runtimeVersion?: string } | undefined)
    ?.runtimeVersion;
  if (!manifestRuntimeVersion) {
    // Some manifest shapes (classic updates) don't carry this field — nothing to compare.
    return true;
  }
  return manifestRuntimeVersion === Updates.runtimeVersion;
}

function isVersionLessThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false;
}

/**
 * Check for available updates.
 *
 * 1. If the current native build is below the minimum required version → force update.
 * 2. If an OTA update is available via expo-updates → prompt to reload.
 * 3. Otherwise → up to date.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  // Skip in dev — expo-updates is not active in development builds
  if (__DEV__ || APP_ENV === 'development') {
    return { type: 'up-to-date' };
  }

  // Never check for or apply an OTA update if this binary's channel doesn't look like it
  // belongs to the environment it thinks it's running in (issue #991).
  if (!isUpdateBoundaryTrusted()) {
    return {
      type: 'error',
      message: `OTA update blocked: running channel "${Updates.channel}" is not trusted for APP_ENV "${APP_ENV}"`,
    };
  }

  try {
    const { Platform } = await import('react-native');
    const platform = Platform.OS as 'ios' | 'android';
    const currentVersion = Constants.expoConfig?.version ?? '1.0.0';
    const minVersion = MIN_NATIVE_VERSION[platform] ?? '1.0.0';

    // Force update: native build is too old
    if (isVersionLessThan(currentVersion, minVersion)) {
      return { type: 'force-update', storeUrl: STORE_URLS[platform] };
    }

    // OTA check via expo-updates
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      if (!isManifestRuntimeCompatible(result.manifest)) {
        return {
          type: 'error',
          message: 'OTA update blocked: manifest runtimeVersion does not match running binary',
        };
      }
      await Updates.fetchUpdateAsync();
      return { type: 'ota-available', manifest: result.manifest };
    }

    return { type: 'up-to-date' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: 'error', message };
  }
}

/** Apply a downloaded OTA update by reloading the app. */
export async function applyOtaUpdate(): Promise<void> {
  // Belt-and-suspenders: don't reload into a fetched update if the running binary's
  // channel is no longer trusted for this environment (see checkForUpdate above).
  if (!isUpdateBoundaryTrusted()) {
    return;
  }
  await Updates.reloadAsync();
}

export default { checkForUpdate, applyOtaUpdate };
