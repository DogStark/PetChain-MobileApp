/**
 * Dependency compatibility gate for Expo + React Native (issue #989).
 *
 * Expo, React Native and the native libraries pinned in package.json can drift
 * beyond a supported matrix without any JavaScript test failing. This script:
 *
 *   1. Asserts the installed `expo` / `react-native` / `react` versions match a
 *      known-good matrix declared below.
 *   2. Runs `expo-doctor` (via `npx expo-doctor`) to catch native config,
 *      plugin and package-version issues.
 *   3. Runs `expo install --check` to flag any dependency whose version is
 *      outside the range Expo expects for this SDK.
 *
 * Exit code is non-zero if any check fails, so CI blocks incompatible upgrades.
 * Uses only local package metadata — no secrets, no network identifiers logged.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Matrix = {
  /** Major version of the Expo SDK this matrix targets. */
  expoSdkMajor: number;
  /** Exact React Native version supported by that SDK. */
  reactNative: string;
  /** Exact React version supported by that SDK. */
  react: string;
};

// Known-good combination for this repo. Update deliberately, in the same PR as
// the upgrade, with iOS + Android build evidence attached.
const SUPPORTED: Matrix = {
  expoSdkMajor: 56,
  reactNative: '0.85.3',
  react: '19.2.7',
};

const root = resolve(__dirname, '..');
const failures: string[] = [];

function installedVersion(pkg: string): string {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`, { paths: [root] });
  return JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version as string;
}

function run(label: string, cmd: string, args: string[]): void {
  process.stdout.write(`\n▶ ${label}: ${cmd} ${args.join(' ')}\n`);
  try {
    execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
  } catch {
    failures.push(label);
  }
}

// ─── 1. Static matrix assertion ────────────────────────────────────────────
console.log('══ Expo / React Native compatibility matrix ══');
try {
  const expo = installedVersion('expo');
  const rn = installedVersion('react-native');
  const react = installedVersion('react');
  const expoMajor = Number(expo.split('.')[0]);

  console.log(`  expo          : ${expo} (SDK ${expoMajor})`);
  console.log(`  react-native  : ${rn}`);
  console.log(`  react         : ${react}`);

  if (expoMajor !== SUPPORTED.expoSdkMajor) {
    failures.push(`expo SDK ${expoMajor} != supported ${SUPPORTED.expoSdkMajor}`);
  }
  if (rn !== SUPPORTED.reactNative) {
    failures.push(`react-native ${rn} != supported ${SUPPORTED.reactNative}`);
  }
  if (react !== SUPPORTED.react) {
    failures.push(`react ${react} != supported ${SUPPORTED.react}`);
  }
} catch (err) {
  failures.push(`could not resolve core packages: ${(err as Error).message}`);
}

// ─── 2. Expo Doctor (native config + package health) ──────────────────────
run('expo-doctor', 'npx', ['--yes', 'expo-doctor@latest']);

// ─── 3. Expo dependency range check ──────────────────────────────────────
run('expo install --check', 'npx', ['--yes', 'expo', 'install', '--check']);

// ─── Result ─────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('\n❌ Dependency compatibility check failed:');
  for (const f of failures) console.error(`   • ${f}`);
  console.error(
    '\nIf this is an intentional upgrade, bump the SUPPORTED matrix in ' +
      'scripts/check-dependency-compat.ts and attach iOS/Android build evidence.',
  );
  process.exit(1);
}

console.log('\n✅ Expo / React Native dependencies are within the supported matrix.');
