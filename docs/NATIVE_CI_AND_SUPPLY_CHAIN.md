# Native CI, End-to-End Journeys & Supply-Chain Metadata

This document covers the mobile hardening work from issues #987–#990.

## 1. Detox safety-critical journeys (#987)

Native end-to-end coverage for the cross-screen flows that can lose data or
money if they break. Specs live in `e2e/journeys/` and run on both the iOS
simulator and the Android emulator via the existing `e2e-detox.yml` workflow
(Detox `testMatch` already globs `e2e/**/*.test.ts`).

| Journey | File | Paths covered |
| --- | --- | --- |
| Authentication | `e2e/journeys/auth.test.ts` | success, invalid credentials, offline, background/foreground session persistence |
| App lock / biometric | `e2e/journeys/appLock.test.ts` | lock on resume, correct PIN, wrong PIN, biometric-permission-denied fallback |
| QR scan | `e2e/journeys/qrScan.test.ts` | valid pet code, camera-permission-denied, malformed payload, unknown code (404) |
| Offline queue | `e2e/journeys/offlineQueue.test.ts` | queue while offline, survive background/foreground, idempotent replay on reconnect |
| Payments | `e2e/journeys/payments.test.ts` | successful charge, declined card, offline, timeout + idempotent retry |

Shared helpers: `e2e/support/journeyHelpers.ts`. Deterministic backend
responses: `e2e/fixtures/backendFixtures.ts`.

**Data & privacy.** Every journey uses synthetic constants only (fake emails,
a fake `4242…` card, opaque `fixture-…-DO-NOT-LOG` tokens). No health records,
contact details, precise location, wallet material or raw tokens are typed,
logged, screenshotted or stored.

**Characterization.** Flows whose `testID`s are not yet wired use the
`isVisible` / `tapIfVisible` probes (same pattern as the existing
`onboarding.test.ts` biometric test) so a spec documents current behavior
without failing the suite. Tighten the probes to hard assertions as the
screens gain test IDs.

Run locally:

```bash
npm run e2e:journeys            # after `detox build --configuration <cfg>`
```

## 2. Native build CI (#988)

`.github/workflows/native-build.yml` compiles **signing-free debug artifacts**
on every PR so CocoaPods, Gradle, manifest and native-module breakages are
caught (JS-only checks miss these):

- **Android** — `expo prebuild` → `./gradlew assembleDebug`, Gradle cache, APK
  and failure logs uploaded.
- **iOS** — `expo prebuild` → `pod install` → `xcodebuild … CODE_SIGNING_ALLOWED=NO`
  for the simulator, CocoaPods cache, build log uploaded.

## 3. Dependency compatibility checks (#989)

`.github/workflows/dependency-compat.yml` runs on changes to `package.json`,
lockfile or native config and executes `scripts/check-dependency-compat.ts`,
which:

1. Asserts installed `expo` / `react-native` / `react` match the `SUPPORTED`
   matrix declared in the script (currently Expo SDK 56 / RN 0.85.3 / React
   19.2.7).
2. Runs `npx expo-doctor`.
3. Runs `npx expo install --check`.

An intentional upgrade must bump `SUPPORTED` in the same PR, with iOS/Android
build evidence attached. Run locally with `npm run deps:check`.

## 4. SBOM & provenance for releases (#990)

`.github/workflows/sbom-provenance.yml` runs per platform (`ios`, `android`) on
`release: published` (or `workflow_dispatch`) and publishes:

- `sbom.cdx.json` — CycloneDX SBOM (`--omit dev`) of the dependency graph.
- `checksums.sha256` — SHA-256 of the SBOM and the build-inputs manifest.
- `build-inputs.json` — commit, ref, runner, tool versions, Expo SDK / RN
  version, EAS profile, timestamp.
- **Signed provenance** via `actions/attest-build-provenance` and a **signed
  SBOM attestation** via `actions/attest-sbom` (keyless Sigstore).

Artifacts are uploaded (90-day retention) and attached to the GitHub Release.
No secrets or tokens are emitted into any of these files. Generate an SBOM
locally with `npm run sbom`.
