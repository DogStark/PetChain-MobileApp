# PetChain Mobile — Deployment Guide

This document covers the complete CI/CD lifecycle for PetChain Mobile: how builds are triggered,
how signing credentials are managed, how tests run, and how to deploy to TestFlight and Google
Play Internal Track.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Required Secrets](#required-secrets)
4. [EAS Build Profiles](#eas-build-profiles)
5. [CI Workflow — Pull Requests](#ci-workflow--pull-requests)
6. [E2E Workflow — Maestro Tests](#e2e-workflow--maestro-tests)
7. [Deploy Workflow — Production Releases](#deploy-workflow--production-releases)
8. [Slack Notifications](#slack-notifications)
9. [Local Development Builds](#local-development-builds)
10. [Running E2E Tests Locally](#running-e2e-tests-locally)
11. [Manual Workflow Dispatch](#manual-workflow-dispatch)
12. [Troubleshooting](#troubleshooting)

---

## Overview

PetChain uses **Expo Application Services (EAS)** to build and sign iOS and Android binaries in
the cloud, eliminating the need to manage certificates, keystores, or provisioning profiles
directly in CI. Signing credentials are stored securely in the Expo Cloud and re-used across
builds.

**Pipeline summary:**

| Trigger | Workflow | Jobs |
|---|---|---|
| Every PR | `ci.yml` | Lint → Format check → Typecheck → Tests + Coverage |
| Push to `main`/PR | `e2e.yml` | EAS APK build → Android emulator → Maestro E2E → Slack |
| Push to `main` | `deploy.yml` | Preflight → EAS Build+Submit (iOS & Android) → Slack |

---

## Architecture

```
                   ┌─────────────────────────────────────┐
   Pull Request    │          ci.yml                      │
   ───────────────►│  Lint → Format → Typecheck → Tests  │
                   └─────────────────────────────────────┘

                   ┌──────────────────────────────────────────────────────────┐
   PR / main push  │          e2e.yml                                          │
   ───────────────►│  EAS preview APK → Emulator → Maestro smoke → Slack     │
                   └──────────────────────────────────────────────────────────┘

                   ┌───────────────────────────────────────────────────────────────┐
   Merge to main   │          deploy.yml                                            │
   ───────────────►│  Preflight → EAS prod build+submit (iOS+Android) → Slack     │
                   │              │                    │                            │
                   │         TestFlight          Play Internal                      │
                   └───────────────────────────────────────────────────────────────┘
```

---

## Required Secrets

Add these to **GitHub → Settings → Secrets and variables → Actions → Repository secrets**:

### Core (required for all workflows)

| Secret | Description |
|---|---|
| `EXPO_TOKEN` | Expo personal access token. Generate at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens). |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL. Create at [api.slack.com/apps](https://api.slack.com/apps). |

### iOS Submission (required for TestFlight deploys)

| Secret | Description |
|---|---|
| `APPLE_ID` | Your Apple ID email (e.g. `dev@petchain.app`) |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password generated at [appleid.apple.com](https://appleid.apple.com). Required for `xcrun altool` / `EAS Submit`. |

> [!NOTE]
> EAS can store iOS distribution certificates and provisioning profiles on its own servers.
> Run `eas credentials` locally once to upload them, after which CI requires only `EXPO_TOKEN`.

### Android Submission (required for Play Store deploys)

| Secret | Description |
|---|---|
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Full JSON content of a Google Play service account key with **Release Manager** role. |

> [!NOTE]
> Like iOS, EAS can store the Android keystore. Run `eas credentials --platform android` once to
> upload the keystore, then CI only needs `EXPO_TOKEN` + the service account for submission.

---

## EAS Build Profiles

Defined in [`eas.json`](../eas.json):

| Profile | Channel | iOS output | Android output | Purpose |
|---|---|---|---|---|
| `development` | — | Device build (dev client) | Device build (dev client) | Local development with `expo-dev-client` |
| `preview` | `preview` | Simulator `.app` | `.apk` | QA testing, E2E CI, ad-hoc distribution |
| `staging` | `staging` | `.ipa` (internal) | `.aab` (internal) | Pre-release validation against staging API |
| `production` | `production` | `.ipa` (App Store) | `.aab` (Play Store) | Store releases |

### Staging build process

The `staging` profile produces **production-grade binaries** (Hermes engine, minification,
release signing) distributed internally via EAS, pointed at the staging API
(`https://staging.petchain.app/api`).

**App identifiers for staging:**

| Platform | Identifier |
|---|---|
| iOS | `app.petchain.mobile.staging` |
| Android | `app.petchain.mobile.staging` |

**Build and distribute:**

```bash
# Build for both platforms
npm run eas:build:staging

# Or target a single platform
eas build --platform ios     --profile staging
eas build --platform android --profile staging
```

Distributes to internal testers via the EAS dashboard. Share the build URL with QA before
promoting to production.

**Environment variables required** (set in `.env.staging` or as EAS secrets):

```bash
APP_ENV=staging
STAGING_API_URL=https://staging.petchain.app/api
SENTRY_DSN=<your-staging-sentry-dsn>
```

> [!IMPORTANT]
> The `staging` profile uses `distribution: internal` — it does **not** submit to the App Store
> or Play Store. Use `production` for store releases.

---

## CI Workflow — Pull Requests

**File:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)  
**Trigger:** Every push to `main`/`master`/`develop`, every PR against those branches.

### Jobs

```
quality  ──►  test
```

1. **quality** — Runs in parallel with no blocking dependencies:
   - `npm run lint` — ESLint across the full codebase
   - `npm run format:check` — Prettier formatting check
   - `npm run typecheck` — TypeScript strict type check

2. **test** — Runs after `quality` passes:
   - `npm run test:ci` — Jest with `--runInBand --ci --coverage`
   - Uploads the `coverage/` directory as a GitHub Actions artifact (retained 14 days)

> [!TIP]
> The `concurrency` group with `cancel-in-progress: true` automatically cancels stale runs on
> the same branch when new commits are pushed, saving runner minutes.

---

## E2E Workflow — Maestro Tests

**File:** [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml)  
**Trigger:** Push to `main`/`master`, PRs against those branches, or manual dispatch.

### Jobs

```
build-preview-apk  ──►  e2e-android
```

1. **build-preview-apk** — Uses `expo-github-action@v8` to authenticate with EAS and build an
   Android APK using the `preview` profile. Polls until the build completes (up to 30 minutes),
   then downloads the APK and uploads it as an artifact.

2. **e2e-android** — Downloads the APK, enables KVM hardware acceleration, starts an Android
   API-33 emulator via `reactivecircus/android-emulator-runner`, installs Maestro CLI, installs
   the APK, and runs the smoke test flow.

### Maestro Test Flows

All flows live under [`.maestro/flows/`](../.maestro/flows/):

| Flow file | Description |
|---|---|
| `smoke-test.yaml` | Launches app → taps through all 5 onboarding slides → asserts Login screen |

**Running locally:**

```bash
# Install Maestro CLI (macOS/Linux)
curl -Ls "https://get.maestro.mobile.dev" | bash

# Run the smoke test against a running emulator/simulator or connected device
npm run e2e:test
# or directly:
maestro test .maestro/flows/smoke-test.yaml
```

---

## Deploy Workflow — Production Releases

**File:** [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)  
**Trigger:** Push to `main`/`master`, or manual dispatch with platform selection.

### Jobs

```
preflight  ──►  eas-build-submit  ──►  notify-success (or notify-failure)
```

1. **preflight** — Runs lint, typecheck, and full test suite. Build does not proceed if any check
   fails.

2. **eas-build-submit** — Calls `eas build --auto-submit` for both iOS and Android:
   - **iOS** → Builds `.ipa` → Submits to **TestFlight** via EAS Submit
   - **Android** → Builds `.aab` → Submits to **Play Store Internal Track** via EAS Submit

3. **notify-success / notify-failure** — Sends a rich Slack Block Kit message with build details,
   commit link, actor, and direct links to the GitHub run and EAS dashboard.

> [!IMPORTANT]
> Before `--auto-submit` works end-to-end, you must configure EAS Submit for both platforms.
> Run the following once locally and commit the credential references EAS stores:
> ```bash
> eas submit --platform ios --latest     # configure once
> eas submit --platform android --latest # configure once
> ```

### Manual Platform Override

Navigate to **Actions → Deploy → Run workflow** and select a specific platform (`ios`,
`android`, or `all`) to build and submit only that platform.

---

## Slack Notifications

Both `e2e.yml` and `deploy.yml` send Slack notifications using the official
[`slackapi/slack-github-action`](https://github.com/slackapi/slack-github-action) action with
Incoming Webhooks.

**Setup steps:**

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps).
2. Enable **Incoming Webhooks** and add a webhook for your `#petchain-ci` channel.
3. Copy the webhook URL and add it as `SLACK_WEBHOOK_URL` in GitHub Secrets.

**Message types:**

| Event | Colour / Icon | Contents |
|---|---|---|
| E2E passed | ✅ Green | Branch, commit, actor, link to run |
| E2E failed | ❌ Red | Branch, commit, actor, link to run |
| Deploy succeeded | ✅ Green | Branch, commit, platform, links to run + EAS dashboard |
| Deploy failed | ❌ Red | Branch, commit, platform, link to failed run |

---

## Local Development Builds

```bash
# Install EAS CLI globally (once)
npm install -g eas-cli

# Login to your Expo account
eas login

# Build a development client for a connected device
npm run eas:build:dev

# Build a preview APK (Android) or Simulator build (iOS) for internal testing
npm run eas:build:preview

# Build production binaries (does NOT submit — use deploy workflow for that)
npm run eas:build:prod
```

---

## Running E2E Tests Locally

```bash
# 1. Start your Android emulator or connect a physical device

# 2. Install and launch the preview APK
#    (download from the EAS dashboard or build locally via npm run eas:build:preview)

# 3. Run the Maestro test suite
npm run e2e:test

# Run a specific flow
maestro test .maestro/flows/smoke-test.yaml

# Watch mode (re-runs on file change during development)
maestro test --continuous .maestro/flows/smoke-test.yaml
```

---

## Manual Workflow Dispatch

All three workflows support `workflow_dispatch`, allowing you to trigger them from the GitHub
Actions UI without a code push:

1. Go to **Actions** in your repository.
2. Select the workflow (`CI`, `E2E Tests`, or `Deploy`).
3. Click **Run workflow**, choose the branch, fill in any inputs, and click **Run workflow**.

The deploy workflow also accepts a `platform` input (`all`, `ios`, `android`) to limit the build
to a single platform.

---

## Troubleshooting

### `EXPO_TOKEN` not found / authentication errors

Ensure the token is added to GitHub Secrets as `EXPO_TOKEN` (not `EXPO_ACCESS_TOKEN`).
Generate a new one at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens).

### EAS build quota exceeded

EAS Free tier allows a limited number of build minutes per month. Monitor usage in the
[Expo dashboard](https://expo.dev). Consider upgrading to EAS Production for unlimited builds.

### Emulator fails to start in E2E workflow

Ensure the `Enable KVM` step runs before the emulator action. If the runner does not support
KVM (some GitHub-hosted runners do not), use a self-hosted runner with nested virtualisation,
or use a cloud device farm (e.g. Firebase Test Lab) as an alternative.

### Maestro flow fails: element not found

Use `maestro studio` locally to inspect the element hierarchy. Make sure `testID` props are
added to key interactive elements for reliable targeting:

```tsx
<TouchableOpacity testID="btn-get-started" onPress={handleNext}>
  <Text>Get Started</Text>
</TouchableOpacity>
```

Then in the flow:
```yaml
- tapOn:
    id: btn-get-started
```

### Play Store submission fails: `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` invalid

Ensure the service account has the **Release Manager** role in Play Console and that the JSON is
the **full file content** (not base64-encoded) in the secret. The account must have completed a
manual first release before automated submissions work.
