# PetChain Mobile App

> Secure pet health records, medication reminders, QR scanning, and emergency SOS — powered by blockchain.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/DogStark/PetChain-MobileApp/releases)

**PetChain** is a comprehensive mobile application for pet owners to securely manage their pets' medical records, medication schedules, vet appointments, and emergency contacts. Built with React Native and Expo, it integrates with the Stellar blockchain to provide immutable, verifiable health records.

---

## 📱 App Store & Google Play Submission

This repository contains everything needed for app store submission under the `storelisting/` directory and `legal/` folder.

**Preparation Status:** Ready for submission pending screenshot and icon generation.

**Submission assets checklist:** See [storelisting/README.md](storelisting/README.md)

Generated assets should be placed in:
- `assets/` — App icons (1024×1024) and splash screen (1284×2778)
- `storelisting/screenshots/ios/` — iOS App Store screenshots
- `storelisting/screenshots/android/` — Google Play screenshots

Legal documents:
- `legal/PrivacyPolicy.md` — Upload to https://petchain.app/privacy
- `legal/TermsOfService.md` — Upload to https://petchain.app/terms

Metadata for store listings:
- `storelisting/ios-subtitle.txt`
- `storelisting/ios-description.txt`
- `storelisting/ios-keywords.txt`
- `storelisting/android-short-description.txt`
- `storelisting/android-full-description.txt`
- `storelisting/android-keywords.txt`
- `storelisting/release-notes-v1.0.0.txt`

Screenshot capture guide:
- `storelisting/screenshots/CAPTURE-GUIDE.md`

---

## ✨ Features

- **🔒 Blockchain-Verified Records:** Immutable medical history on Stellar
- **📱 QR Code Scanner:** Instant pet identification and record sharing
- **💊 Medication Reminders:** Smart notifications for doses and refills
- **📅 Appointment Management:** Vet visit scheduling with reminders
- **🚨 Emergency SOS:** One-tap alert to emergency contacts with location
- **📊 Health Dashboard:** Visual health scoring and trend tracking
- **👥 Multi-Pet Support:** Manage unlimited pets (Premium) or 1 (Free)
- **🌐 Offline-First:** Full functionality without internet
- **🔐 Privacy-First:** AES-256 encryption, biometric login, GDPR compliant
- **🌍 Multi-Language:** English and Spanish, more coming soon

---

## 🛠 Tech Stack

| Layer | Technology |
|--------|-----------|
| **Framework** | React Native (Expo SDK) |
| **Language** | TypeScript |
| **Navigation** | React Navigation v6 |
| **Backend** | Node.js, Express, PostgreSQL |
| **Blockchain** | Stellar SDK (medical record hashes) |
| **Database** | SQLite (local), PostgreSQL (cloud) |
| **Storage** | Encrypted AsyncStorage + Cloud Sync |
| **Auth** | JWT, OAuth (Google/Apple/Facebook) |
| **Push** | Expo Notifications (APNs & FCM) |
| **Error Tracking** | Sentry |
| **Testing** | Jest, Vitest, React Native Testing Library |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system diagrams.

---

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 18
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator or Android Emulator (optional, for local testing)

### Installation
```bash
# Clone repository
git clone https://github.com/DogStark/PetChain-MobileApp.git
cd PetChain-MobileApp

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.development
# Edit .env.development with your API endpoint

# Start development server
npm start
```

### Running on Device
```bash
# Start Expo and press i (iOS) or a (Android) in the terminal
npm start

# Or scan the QR code with Expo Go on your phone
```

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for development workflow.

---

## 🌱 Database Seeding

### Quick Setup

```bash
# 1. Ensure database is running
# 2. Run migrations
npm run migrate

# 3. Seed data
npm run seed:dev

# 4. Verify
npm test -- backend/seeds/__tests__/seedData.test.ts
```

### One-Liner Commands

```bash
# Default seed
npm run seed

# Development preset
npm run seed:dev

# Testing preset (minimal data)
npm run seed:test

# Large dataset
npm run seed:large

# Custom configuration
ts-node backend/seeds/index.ts --owners 10 --vets 5 --pets 3 --records 4 --appointments 3 --medications 2
```

### Configuration Flags

| Flag | Default | Example |
|------|---------|---------|
| `--owners` | 5 | `--owners 10` |
| `--vets` | 3 | `--vets 5` |
| `--pets` | 2 | `--pets 3` |
| `--records` | 3 | `--records 5` |
| `--appointments` | 2 | `--appointments 4` |
| `--medications` | 1 | `--medications 2` |

### Data Generated

```
Users:        5 owners + 3 vets = 8 total
Pets:         5 owners × 2 pets = 10 total
Records:      10 pets × 3 records = 30 total
Appointments: 10 pets × 2 appointments = 20 total
Medications:  10 pets × 1 medication = 10 total
```

---

## 🔧 Pre-Commit Hooks (Husky + lint-staged)

PetChain enforces code quality automatically on every commit using [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged).

### How it works

When you run `git commit`, Husky fires `.husky/pre-commit`, which in turn runs `lint-staged` against the staged files only — so you never wait for the entire codebase to be linted.

```
git commit
  └─▶ .husky/pre-commit
        └─▶ npx lint-staged
              ├─▶ ESLint --fix   (on staged .ts / .tsx / .js / .jsx)
              └─▶ Prettier --write (on staged .ts / .tsx / .js / .jsx / .json / .md / .yml)
```

If ESLint finds errors it **cannot** auto-fix, the commit is aborted and the issues are printed to your terminal. Fix them, `git add` the changes, and try again.

### Configuration

`lint-staged` is configured directly in `package.json`:

```json
"lint-staged": {
  "{src,backend}/**/*.{ts,tsx,js,jsx}": [
    "eslint --fix --max-warnings=-1",
    "prettier --write"
  ],
  "{src,backend}/**/*.{json,md,yml,yaml}": [
    "prettier --write"
  ],
  "*.{ts,tsx,js,jsx}": [
    "eslint --fix --max-warnings=-1",
    "prettier --write"
  ]
}
```

Husky is installed via the `prepare` lifecycle script, so hooks are set up automatically after `npm install`.

### Setup (one-time, already runs on `npm install`)

```bash
npm install          # runs `husky` via the "prepare" script
```

If hooks are not triggering (e.g. after cloning into an environment where `prepare` was skipped):

```bash
npx husky            # re-installs the hooks
```

### Skipping hooks (emergency use only)

```bash
git commit --no-verify -m "chore: emergency hotfix"
```

> ⚠️ Only use `--no-verify` when absolutely necessary. All CI checks still run on the pull request.

### Running linters manually

```bash
# Lint and auto-fix all TypeScript/JavaScript files
npm run lint:fix

# Check formatting without writing changes
npm run format:check

# Format all files
npm run format
```

---

## 🧪 Testing
```bash
# Unit tests
npm test

# Lint & typecheck
npm run lint
npm run typecheck

# CI pipeline (runs on every PR)
# GitHub Actions workflows are in .github/workflows/
```

### API Mocking with MSW (Mock Service Worker)

All tests use [MSW v2](https://mswjs.io/) to intercept HTTP requests and return realistic fixture data, eliminating real network calls in the test suite.

**Setup files:**
- `src/__mocks__/handlers.ts` — REST handlers for `/auth`, `/pets`, and `/appointments` endpoints with fixture data
- `src/__mocks__/server.ts` — MSW `setupServer` instance wired to the above handlers

**jest.setup.js** automatically starts and tears down the server around every test suite:
```js
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Override handlers in a single test:**
```ts
import { server } from '../../__mocks__/server';
import { http, HttpResponse } from 'msw';

it('handles 401', async () => {
  server.use(
    http.post('http://localhost:3000/api/auth/login', () =>
      HttpResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 }),
    ),
  );
  // ... rest of test
});
```

---

## 📄 Legal

- [Privacy Policy](https://petchain.app/privacy) — How we handle your data
- [Terms of Service](https://petchain.app/terms) — Usage agreement

PetChain is not a substitute for professional veterinary care. Always consult a licensed veterinarian for medical advice.

---

## 📞 Support

- Issues: https://github.com/DogStark/PetChain-MobileApp/issues
- Email: support@petchain.app
- Twitter: [@petchainapp](https://twitter.com/petchainapp)
- Website: https://petchain.app

---

## 📢 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgements

- Built with ❤️ for pet lovers everywhere
- Powered by [Stellar](https://stellar.org) blockchain
- UI/UX inspired by modern health & fitness apps
- Thanks to all contributors and beta testers

---

**Status:** Version 1.0.0 — Ready for App Store & Google Play submission.

