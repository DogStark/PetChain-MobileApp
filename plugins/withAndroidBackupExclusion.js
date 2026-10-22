/**
 * withAndroidBackupExclusion.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Expo Config Plugin — Android Backup Exclusion
 *
 * WHAT THIS DOES
 * ──────────────
 * 1. Sets android:allowBackup="false" in AndroidManifest.xml.
 *    Disables Android Auto Backup for API 22 and below and tells the OS that
 *    this app opts into a custom backup scheme rather than the default
 *    full-data backup.
 *
 * 2. Injects android:fullBackupContent="@xml/backup_rules" for API 23 – 30.
 *    References android-config/backup_rules.xml which explicitly excludes
 *    databases/petchain.db, SharedPreferences, and the file-system documents.
 *
 * 3. Injects android:dataExtractionRules="@xml/data_extraction_rules" for API 31+.
 *    References android-config/data_extraction_rules.xml which applies the same
 *    exclusions to both cloudBackup and deviceTransfer transports.
 *
 * 4. Copies backup_rules.xml and data_extraction_rules.xml into the generated
 *    android/app/src/main/res/xml/ directory so they are included in the APK/AAB.
 *
 * PLATFORMS
 * ─────────
 * Android API 23+ (Auto Backup). Tested with Android 8 – 14.
 *
 * SECURITY NOTE
 * ─────────────
 * expo-secure-store writes to the Android Keystore which is never included in
 * any backup transport. This plugin handles the remaining local storage surfaces:
 * SQLite (petchain.db via expo-sqlite) and AsyncStorage (RNCAsyncStorage in
 * SharedPreferences). Even though both are AES-256 encrypted, the ciphertext is
 * excluded from backup because the encryption key lives in the Keystore and would
 * not survive a cross-device restore.
 *
 * REFERENCES
 * ──────────
 * https://developer.android.com/guide/topics/data/autobackup
 * https://developer.android.com/reference/android/R.attr#allowBackup
 * https://developer.android.com/reference/android/R.attr#dataExtractionRules
 */

// @ts-check
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── Paths to the XML files we ship with the app ─────────────────────────────

/** Relative to the monorepo root */
const BACKUP_RULES_SRC = path.join(__dirname, '..', 'android-config', 'backup_rules.xml');
const EXTRACTION_RULES_SRC = path.join(
  __dirname,
  '..',
  'android-config',
  'data_extraction_rules.xml',
);

// ─── Plugin entry point ───────────────────────────────────────────────────────

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
function withAndroidBackupExclusion(config) {
  // Step 1 — patch AndroidManifest.xml
  config = withAndroidManifest(config, (expoConfig) => {
    const manifest = expoConfig.modResults;
    const application = getOrCreateApplication(manifest);

    // android:allowBackup="false"
    application.$['android:allowBackup'] = 'false';

    // android:fullBackupContent for API 23 – 30
    application.$['android:fullBackupContent'] = '@xml/backup_rules';

    // android:dataExtractionRules for API 31+
    application.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';

    return expoConfig;
  });

  // Step 2 — copy the XML rule files into res/xml/ during prebuild
  config = withDangerousMod(config, [
    'android',
    (expoConfig) => {
      const platformRoot = expoConfig.modRequest.platformProjectRoot;
      const resXmlDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'xml');

      // Create res/xml/ if it doesn't already exist
      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }

      // Copy backup_rules.xml
      if (fs.existsSync(BACKUP_RULES_SRC)) {
        fs.copyFileSync(BACKUP_RULES_SRC, path.join(resXmlDir, 'backup_rules.xml'));
      } else {
        console.warn(
          '[withAndroidBackupExclusion] backup_rules.xml not found at',
          BACKUP_RULES_SRC,
        );
      }

      // Copy data_extraction_rules.xml
      if (fs.existsSync(EXTRACTION_RULES_SRC)) {
        fs.copyFileSync(
          EXTRACTION_RULES_SRC,
          path.join(resXmlDir, 'data_extraction_rules.xml'),
        );
      } else {
        console.warn(
          '[withAndroidBackupExclusion] data_extraction_rules.xml not found at',
          EXTRACTION_RULES_SRC,
        );
      }

      return expoConfig;
    },
  ]);

  return config;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the <application> element from the manifest, creating it if absent.
 *
 * @param {import('@expo/config-plugins/build/android/Manifest').AndroidManifest} manifest
 */
function getOrCreateApplication(manifest) {
  if (!manifest.manifest.application) {
    manifest.manifest.application = [{ $: {} }];
  }
  const app = manifest.manifest.application[0];
  if (!app.$) app.$ = {};
  return app;
}

module.exports = withAndroidBackupExclusion;
