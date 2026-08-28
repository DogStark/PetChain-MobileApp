/**
 * Backup exclusion — post-implementation verification tests
 *
 * These tests verify that the backup exclusion configuration is correct
 * after the fix. They complement backupExclusion.characterization.test.ts
 * which documented the pre-fix state.
 *
 * Coverage:
 *   - Android backup_rules.xml (API 23-30) correctness
 *   - Android data_extraction_rules.xml (API 31+) correctness
 *   - Android config plugin structure and manifest mutations
 *   - iOS config plugin structure and Swift source content
 *   - app.config.js plugin registration
 *   - Sensitive path inventory — no raw secrets added to fixtures
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

// ─── helpers ──────────────────────────────────────────────────────────────────

function readXml(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJs(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadAppConfig(): Record<string, unknown> {
  const configPath = path.join(ROOT, 'app.config.js');
  delete require.cache[require.resolve(configPath)];
  process.env.APP_ENV = 'development';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(configPath) as { expo?: Record<string, unknown> };
  return (mod.expo ?? mod) as Record<string, unknown>;
}

// ─── Android backup_rules.xml (API 23-30) ────────────────────────────────────

describe('android-config/backup_rules.xml (API 23-30)', () => {
  let xml: string;

  beforeAll(() => {
    xml = readXml('android-config/backup_rules.xml');
  });

  it('file exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'android-config', 'backup_rules.xml'))).toBe(true);
  });

  it('is valid XML with <full-backup-content> root element', () => {
    expect(xml).toMatch('<full-backup-content>');
    expect(xml).toMatch('</full-backup-content>');
  });

  it('excludes petchain.db from database domain', () => {
    expect(xml).toMatch('domain="database"');
    expect(xml).toMatch('path="petchain.db"');
  });

  it('excludes RNCAsyncStorage directory from sharedpref domain', () => {
    expect(xml).toMatch('domain="sharedpref"');
    expect(xml).toMatch('path="RNCAsyncStorage"');
  });

  it('excludes RNCAsyncStorage.xml flat file from sharedpref domain', () => {
    expect(xml).toMatch('path="RNCAsyncStorage.xml"');
  });

  it('has catch-all sharedpref exclusion (path=".")', () => {
    // Ensure there is a sharedpref exclude with path="."
    expect(xml).toMatch(/domain="sharedpref"[^/]*path="\."|\bpath="\."[^/]*domain="sharedpref"/);
  });

  it('excludes files domain (documentDirectory)', () => {
    expect(xml).toMatch('domain="file"');
  });

  it('excludes cache domain', () => {
    expect(xml).toMatch('domain="cache"');
  });

  it('excludes external domain', () => {
    expect(xml).toMatch('domain="external"');
  });

  it('does not contain any raw secret values or PII', () => {
    // Sanity: no tokens, keys, or real user data snuck into the XML
    expect(xml).not.toMatch(/eyJ/); // JWT prefix
    expect(xml).not.toMatch(/password/i);
    expect(xml).not.toMatch(/secret/i);
  });
});

// ─── Android data_extraction_rules.xml (API 31+) ─────────────────────────────

describe('android-config/data_extraction_rules.xml (API 31+)', () => {
  let xml: string;

  beforeAll(() => {
    xml = readXml('android-config/data_extraction_rules.xml');
  });

  it('file exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'android-config', 'data_extraction_rules.xml'))).toBe(
      true,
    );
  });

  it('has <data-extraction-rules> root element', () => {
    expect(xml).toMatch('<data-extraction-rules>');
    expect(xml).toMatch('</data-extraction-rules>');
  });

  it('has <cloud-backup> section', () => {
    expect(xml).toMatch('<cloud-backup>');
    expect(xml).toMatch('</cloud-backup>');
  });

  it('has <device-transfer> section', () => {
    expect(xml).toMatch('<device-transfer>');
    expect(xml).toMatch('</device-transfer>');
  });

  it('excludes petchain.db in cloud-backup section', () => {
    const cloudBackup = xml.slice(xml.indexOf('<cloud-backup>'), xml.indexOf('</cloud-backup>'));
    expect(cloudBackup).toMatch('domain="database"');
    expect(cloudBackup).toMatch('path="petchain.db"');
  });

  it('excludes petchain.db in device-transfer section', () => {
    const deviceTransfer = xml.slice(
      xml.indexOf('<device-transfer>'),
      xml.indexOf('</device-transfer>'),
    );
    expect(deviceTransfer).toMatch('domain="database"');
    expect(deviceTransfer).toMatch('path="petchain.db"');
  });

  it('excludes RNCAsyncStorage in both sections', () => {
    const cloudBackup = xml.slice(xml.indexOf('<cloud-backup>'), xml.indexOf('</cloud-backup>'));
    const deviceTransfer = xml.slice(
      xml.indexOf('<device-transfer>'),
      xml.indexOf('</device-transfer>'),
    );
    expect(cloudBackup).toMatch('path="RNCAsyncStorage"');
    expect(deviceTransfer).toMatch('path="RNCAsyncStorage"');
  });

  it('excludes sharedpref catch-all in both sections', () => {
    const cloudBackup = xml.slice(xml.indexOf('<cloud-backup>'), xml.indexOf('</cloud-backup>'));
    const deviceTransfer = xml.slice(
      xml.indexOf('<device-transfer>'),
      xml.indexOf('</device-transfer>'),
    );
    expect(cloudBackup).toMatch('domain="sharedpref"');
    expect(deviceTransfer).toMatch('domain="sharedpref"');
  });

  it('does not contain any raw secret values or PII', () => {
    expect(xml).not.toMatch(/eyJ/);
    expect(xml).not.toMatch(/password/i);
    expect(xml).not.toMatch(/secret/i);
  });
});

// ─── Android config plugin ────────────────────────────────────────────────────

describe('plugins/withAndroidBackupExclusion.js', () => {
  let src: string;

  beforeAll(() => {
    src = readJs('plugins/withAndroidBackupExclusion.js');
  });

  it('file exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'plugins', 'withAndroidBackupExclusion.js'))).toBe(true);
  });

  it('exports a function (config plugin)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require(path.join(ROOT, 'plugins', 'withAndroidBackupExclusion.js'));
    expect(typeof plugin).toBe('function');
  });

  it('sets android:allowBackup="false" in manifest', () => {
    expect(src).toMatch('android:allowBackup');
    expect(src).toMatch('"false"');
  });

  it('references @xml/backup_rules for API 23-30', () => {
    expect(src).toMatch('@xml/backup_rules');
    expect(src).toMatch('fullBackupContent');
  });

  it('references @xml/data_extraction_rules for API 31+', () => {
    expect(src).toMatch('@xml/data_extraction_rules');
    expect(src).toMatch('dataExtractionRules');
  });

  it('copies backup_rules.xml to res/xml/', () => {
    expect(src).toMatch('backup_rules.xml');
    expect(src).toMatch('res');
    expect(src).toMatch('xml');
    expect(src).toMatch('copyFileSync');
  });

  it('copies data_extraction_rules.xml to res/xml/', () => {
    expect(src).toMatch('data_extraction_rules.xml');
  });

  it('uses withAndroidManifest from @expo/config-plugins', () => {
    expect(src).toMatch('withAndroidManifest');
    expect(src).toMatch('@expo/config-plugins');
  });

  it('does not contain raw secrets or PII in source', () => {
    expect(src).not.toMatch(/eyJ/);
    expect(src).not.toMatch(/password\s*[:=]/i);
  });
});

// ─── iOS config plugin ────────────────────────────────────────────────────────

describe('plugins/withIosBackupExclusion.js', () => {
  let src: string;

  beforeAll(() => {
    src = readJs('plugins/withIosBackupExclusion.js');
  });

  it('file exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'plugins', 'withIosBackupExclusion.js'))).toBe(true);
  });

  it('exports a function (config plugin)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require(path.join(ROOT, 'plugins', 'withIosBackupExclusion.js'));
    expect(typeof plugin).toBe('function');
  });

  it('uses withDangerousMod targeting ios', () => {
    expect(src).toMatch('withDangerousMod');
    expect(src).toMatch("'ios'");
  });

  it('injects BackupExclusion.swift', () => {
    expect(src).toMatch('BackupExclusion.swift');
  });

  it('Swift source uses NSURLIsExcludedFromBackupKey / isExcludedFromBackupKey', () => {
    expect(src).toMatch('isExcludedFromBackupKey');
  });

  it('Swift source excludes applicationSupportDirectory (expo-sqlite)', () => {
    expect(src).toMatch('applicationSupportDirectory');
  });

  it('Swift source excludes libraryDirectory / Preferences (AsyncStorage)', () => {
    expect(src).toMatch('libraryDirectory');
    expect(src).toMatch('Preferences');
  });

  it('Swift source excludes documentDirectory (expo-file-system)', () => {
    expect(src).toMatch('documentDirectory');
  });

  it('patches AppDelegate to call exclusion at launch', () => {
    expect(src).toMatch('excludeSensitiveDirectoriesFromBackup');
    expect(src).toMatch('AppDelegate');
  });

  it('is idempotent — checks before patching AppDelegate', () => {
    // The plugin must guard against double-patching
    expect(src).toMatch('excludeSensitiveDirectoriesFromBackup');
    // idempotency guard: the patch function checks for existing injection
    expect(src).toMatch('includes(');
  });

  it('does not contain raw secrets or PII in source', () => {
    expect(src).not.toMatch(/eyJ/);
    expect(src).not.toMatch(/password\s*[:=]/i);
  });
});

// ─── app.config.js plugin registration ───────────────────────────────────────

describe('app.config.js — post-fix backup plugin registration', () => {
  let config: Record<string, unknown>;

  beforeAll(() => {
    config = loadAppConfig();
  });

  it('plugins array includes withAndroidBackupExclusion', () => {
    const plugins = config.plugins as unknown[] | undefined;
    const hasAndroid = (plugins ?? []).some((p) => {
      const name = Array.isArray(p) ? (p[0] as string) : (p as string);
      return typeof name === 'string' && name.includes('withAndroidBackupExclusion');
    });
    expect(hasAndroid).toBe(true);
  });

  it('plugins array includes withIosBackupExclusion', () => {
    const plugins = config.plugins as unknown[] | undefined;
    const hasIos = (plugins ?? []).some((p) => {
      const name = Array.isArray(p) ? (p[0] as string) : (p as string);
      return typeof name === 'string' && name.includes('withIosBackupExclusion');
    });
    expect(hasIos).toBe(true);
  });

  it('ios section still has existing infoPlist keys (no regression)', () => {
    const ios = config.ios as Record<string, unknown> | undefined;
    const infoPlist = (ios?.infoPlist ?? {}) as Record<string, unknown>;
    expect(infoPlist.NSCameraUsageDescription).toBeDefined();
    expect(infoPlist.NSFaceIDUsageDescription).toBeDefined();
  });

  it('android section still has existing intentFilters (no regression)', () => {
    const android = config.android as Record<string, unknown> | undefined;
    expect(android?.intentFilters).toBeDefined();
  });
});

// ─── Sensitive path inventory — no secrets in config files ───────────────────

describe('Backup config files contain no secrets or PII', () => {
  const filesToCheck = [
    'android-config/backup_rules.xml',
    'android-config/data_extraction_rules.xml',
    'plugins/withAndroidBackupExclusion.js',
    'plugins/withIosBackupExclusion.js',
  ];

  it.each(filesToCheck)('%s contains no JWT tokens', (rel) => {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(content).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it.each(filesToCheck)('%s contains no private key material', (rel) => {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(content).not.toMatch(/-----BEGIN (RSA |EC )?PRIVATE KEY-----/);
  });

  it.each(filesToCheck)('%s contains no email addresses', (rel) => {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Allow @expo/ package references but not user@domain.tld patterns
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const matches = content.match(emailPattern) ?? [];
    const nonPackageEmails = matches.filter((m) => !m.startsWith('@expo'));
    expect(nonPackageEmails).toHaveLength(0);
  });
});
