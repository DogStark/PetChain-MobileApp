/**
 * Characterization tests — backup exclusion (pre-implementation baseline)
 *
 * PURPOSE:
 *   These tests document the CURRENT (pre-fix) backup configuration so we
 *   know exactly what changed after implementing Android / iOS backup
 *   exclusions. They are written before the fix and are expected to start
 *   failing once the fix is applied (where marked "EXPECTED TO FAIL AFTER FIX").
 *   Tests that should still pass after the fix are marked accordingly.
 *
 * SENSITIVE DATA INVENTORY (from audit):
 *   Android (expo-sqlite / AsyncStorage via SQLite):
 *     - databases/petchain.db   → AES-256 encrypted content, but file SHOULD
 *                                  be excluded from adb-backup / cloud-backup
 *     - shared_prefs/           → AsyncStorage-backed values (access/refresh tokens,
 *                                  session, pets list, sync state, notification map)
 *   iOS (equivalent):
 *     - Documents/ExponentExperienceData/<bundleId>/SQLite/petchain.db
 *     - NSUserDefaults (RNCAsyncStorage)
 *   expo-secure-store items:
 *     These are already stored in the platform Keychain/Keystore and are
 *     NOT included in standard OS backups by default. No extra work needed,
 *     but we assert the behaviour here for documentation.
 *
 * PLATFORMS:
 *   - Android API 23+ — full-data backup (allowBackup=true by default in Expo apps)
 *   - Android API 31+ — additionally respects data_extraction_rules.xml
 *   - iOS — iCloud backup includes app Documents folder by default unless
 *            NSURLIsExcludedFromBackupKey is set
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── helpers ─────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../../..');
const APP_CONFIG_PATH = path.join(ROOT, 'app.config.js');

/**
 * Resolve the runtime config object exported by app.config.js.
 * We require() it directly so the test runs in-process without spawning
 * a child process. A temp env is injected to avoid side-effects.
 */
function loadAppConfig(): Record<string, unknown> {
  // Clear the require cache so we always get a fresh evaluation
  delete require.cache[require.resolve(APP_CONFIG_PATH)];
  // Stub dotenv so it doesn't try to read .env files during the test
  process.env.APP_ENV = 'development';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(APP_CONFIG_PATH) as { expo?: Record<string, unknown> };
  return (mod.expo ?? mod) as Record<string, unknown>;
}

// ─── characterization: app.config.js (pre-fix state) ─────────────────────────

describe('app.config.js — pre-fix backup configuration (characterization)', () => {
  let config: Record<string, unknown>;

  beforeAll(() => {
    config = loadAppConfig();
  });

  // --- Android ---

  it('android section does NOT yet set allowBackup=false  [EXPECTED TO FAIL AFTER FIX]', () => {
    const android = config.android as Record<string, unknown> | undefined;
    // Pre-fix: allowBackup is absent (defaults to true inside Android manifest)
    expect(android).toBeDefined();
    expect(android!.allowBackup).toBeUndefined();
  });

  it('android section does NOT yet reference a backupAgent  [EXPECTED TO FAIL AFTER FIX]', () => {
    const android = config.android as Record<string, unknown> | undefined;
    expect(android!.backupAgent).toBeUndefined();
  });

  it('plugins array does NOT yet include a backup-exclusion config plugin  [EXPECTED TO FAIL AFTER FIX]', () => {
    const plugins = config.plugins as unknown[] | undefined;
    const hasBackupPlugin = (plugins ?? []).some((p) => {
      const name = Array.isArray(p) ? (p[0] as string) : (p as string);
      return typeof name === 'string' && name.includes('backup');
    });
    expect(hasBackupPlugin).toBe(false);
  });

  // --- iOS ---

  it('ios infoPlist does NOT yet set NSURLIsExcludedFromBackupKey  [EXPECTED TO FAIL AFTER FIX]', () => {
    const ios = config.ios as Record<string, unknown> | undefined;
    const infoPlist = (ios?.infoPlist ?? {}) as Record<string, unknown>;
    expect(infoPlist.NSURLIsExcludedFromBackupKey).toBeUndefined();
  });
});

// ─── characterization: Android backup rules files (pre-fix state) ─────────────

describe('Android backup rules XML files — pre-fix state (characterization)', () => {
  const backupRulesPath = path.join(ROOT, 'android-config', 'backup_rules.xml');
  const extractionRulesPath = path.join(ROOT, 'android-config', 'data_extraction_rules.xml');

  it('backup_rules.xml does NOT yet exist  [EXPECTED TO FAIL AFTER FIX]', () => {
    expect(fs.existsSync(backupRulesPath)).toBe(false);
  });

  it('data_extraction_rules.xml does NOT yet exist  [EXPECTED TO FAIL AFTER FIX]', () => {
    expect(fs.existsSync(extractionRulesPath)).toBe(false);
  });
});

// ─── characterization: iOS backup config plugin (pre-fix state) ───────────────

describe('iOS backup config plugin — pre-fix state (characterization)', () => {
  const pluginPath = path.join(ROOT, 'plugins', 'withIosBackupExclusion.js');

  it('withIosBackupExclusion plugin does NOT yet exist  [EXPECTED TO FAIL AFTER FIX]', () => {
    expect(fs.existsSync(pluginPath)).toBe(false);
  });
});

// ─── invariant: sensitive storage keys catalogue ──────────────────────────────
// These assertions describe the sensitive keys the app persists locally.
// They must remain accurate after the fix — if new sensitive keys are added,
// this test should be updated to document them.

describe('Sensitive local storage key inventory (invariant — must stay accurate)', () => {
  const STORAGE_KEYS_PATH = path.join(ROOT, 'src', 'config', 'storageKeys.ts');

  it('storageKeys.ts exists and contains auth token keys', () => {
    expect(fs.existsSync(STORAGE_KEYS_PATH)).toBe(true);
    const content = fs.readFileSync(STORAGE_KEYS_PATH, 'utf8');
    expect(content).toMatch('@auth/access_token');
    expect(content).toMatch('@auth/refresh_token');
    expect(content).toMatch('@auth/session');
  });

  it('storageKeys.ts contains pets and sync cache keys', () => {
    const content = fs.readFileSync(STORAGE_KEYS_PATH, 'utf8');
    expect(content).toMatch('@pets/list');
    expect(content).toMatch('@pets/detail:');
    expect(content).toMatch('@sync/pending_queue');
  });

  const BACKUP_SERVICE_PATH = path.join(ROOT, 'src', 'services', 'backupService.ts');

  it('backupService.ts contains keys for PII and health data', () => {
    expect(fs.existsSync(BACKUP_SERVICE_PATH)).toBe(true);
    const content = fs.readFileSync(BACKUP_SERVICE_PATH, 'utf8');
    // Keys managing health/personal data that must be excluded from OS backup
    expect(content).toMatch('@user_profile');
    expect(content).toMatch('@notification_preferences');
    expect(content).toMatch('@pets_list');
    expect(content).toMatch('@emergency_contacts');
    expect(content).toMatch('@pet_photos');
  });
});

// ─── invariant: expo-secure-store items are NOT backed up ────────────────────
// expo-secure-store maps to the iOS Keychain and Android Keystore, neither of
// which are exported in device backups.  This test documents that the app does
// NOT store raw secrets in AsyncStorage or SQLite kv_store.

describe('expo-secure-store — NOT backed up by OS (invariant)', () => {
  const BIOMETRIC_SERVICE = path.join(ROOT, 'src', 'services', 'biometricService.ts');
  const AUTH_SERVICE = path.join(ROOT, 'src', 'services', 'authService.ts');

  it('biometricService uses expo-secure-store, not AsyncStorage, for credentials', () => {
    if (!fs.existsSync(BIOMETRIC_SERVICE)) return; // skip if file absent
    const content = fs.readFileSync(BIOMETRIC_SERVICE, 'utf8');
    expect(content).toMatch('expo-secure-store');
  });

  it('authService does not write raw tokens to plain AsyncStorage', () => {
    if (!fs.existsSync(AUTH_SERVICE)) return;
    const content = fs.readFileSync(AUTH_SERVICE, 'utf8');
    // The auth service must NOT call plain AsyncStorage.setItem directly for tokens
    // (it should go through encryptedAsyncStorage or expo-secure-store).
    // We check it does not import unencrypted AsyncStorage for token persistence.
    const rawAsyncStorageTokenWrite =
      /AsyncStorage\.setItem\(['"`]@auth\/access_token/.test(content) ||
      /AsyncStorage\.setItem\(['"`]@auth\/refresh_token/.test(content);
    expect(rawAsyncStorageTokenWrite).toBe(false);
  });
});
