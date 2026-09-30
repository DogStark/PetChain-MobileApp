# Telemedicine security hardening

Synthetic-data-only notes for the telemedicine relay, chat cache and attachment
pipeline. All modules below are dependency-free (Node `crypto` / `Buffer` only)
and run under the `node` Jest environment.

## TURN credential rotation and expiry (`src/services/turnCredentialService.ts`)

- Credentials follow the coturn "REST API for TURN" pattern:
  `username = <expiryUnix>:<principal>`,
  `credential = base64(HMAC-SHA1(sharedSecret, username))`.
- No long-lived secret ships to a device; a leaked credential stops working at
  its embedded expiry (default TTL 300s, clamped to 30s–24h).
- `TurnCredentialManager` caches one live credential, re-issues within
  `TURN_REFRESH_SKEW_SECONDS` (60s) of expiry, coalesces concurrent fetches, and
  exposes `recoverExpiredSession()` for the "relay rejected the session" path.
- `verifyTurnCredential` accepts the previous secret during a rotation grace
  window so secret rotation never drops an in-flight call.

## Chat history isolation on logout (`src/services/telemedicineChatVault.ts`)

- Each account has its own random 256-bit data key in the secure keystore; cache
  rows are AES-256-GCM ciphertext keyed by account id.
- `logout()` / `switchAccount()` destroy the key **first**, then purge the cache.
  An interrupted purge still fails closed — leftover ciphertext is unreadable.
- `readHistory()` returns `[]` when no key is present, so a newly signed-in
  account can never see the previous account's cached messages or attachment
  metadata.

## Attachment malware / content-type validation (`src/services/attachmentValidationService.ts`)

- `sniffContentType` identifies files by magic bytes; `looksExecutable` blocks
  PE/ELF/Mach-O/Java/shell/`<script>`/`<?php`.
- `validateAttachment` enforces `MAX_ATTACHMENT_BYTES` (15 MiB), an allowlist
  (`png/jpeg/gif/webp/pdf/plain`), rejects empty files, and **quarantines**
  declared-vs-detected mismatches and disguised executables.
- `safeDownloadHeaders` returns `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`
  and `Cache-Control: private, no-store` for the download route.
- Filenames are sanitised (path/traversal/`\w.-` only, 128 char cap).

## Runtime response validation (`src/services/runtimeValidation.ts`)

- Tiny schema combinator (`v.object/array/string/number/boolean/literal/optional`)
  with `.parse()` returning `{ success, data } | { success:false, issues }`.
- `parseResponse(schema, data, context)` throws a single `ResponseValidationError`
  carrying every issue instead of letting malformed nested JSON crash a screen.
- Wired into `telemedicineService.getTelemedicineAvailability`; extend to the
  other `src/services` calls incrementally.

## Platform notes

Logic is pure TypeScript with no native modules, so iOS and Android behave
identically. Injectable keystore/cache/clock seams make the flows testable
without a device; no secrets, tokens or health data are written to logs,
fixtures or analytics.
