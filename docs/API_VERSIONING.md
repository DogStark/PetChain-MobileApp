# API Versioning & Deprecation Schedule

## Overview

The PetChain backend enforces API versions via the `X-API-Version` request header.
Every client request **must** include this header. Requests with a missing header or a
version below the current minimum are rejected with **410 Gone**.

```json
{
  "error": "api_version_unsupported",
  "minimumVersion": "2.0",
  "message": "API version 1.0 is no longer supported. Please upgrade to v2.0 or later.",
  "docsUrl": "/api/docs/migration-v1-to-v2.md"
}
```

The client SDK (`src/config/index.ts → api.version`) is set to the current version and
is included automatically in every request by `apiClient.ts`.

---

## Version Lifecycle

| Status      | Description                                                    |
|-------------|----------------------------------------------------------------|
| **Current** | Fully supported; no warnings.                                  |
| **Deprecated** | Still served; `Deprecation` and `Sunset` headers returned. |
| **Sunset**  | Rejected with 410 Gone.                                        |

---

## Deprecation Schedule

| Version | Status     | Deprecated   | Sunset (end of service) | Notes                          |
|---------|------------|--------------|-------------------------|--------------------------------|
| 1.0     | Sunset     | 2026-06-01   | **2026-06-25**          | Rejected with 410 Gone         |
| 2.0     | **Current** | —           | 2026-12-01 (planned)    | Minimum accepted version       |

---

## How to Upgrade Clients

### v1.0 → v2.0

1. Update `src/config/index.ts` — set `api.version` to `'2.0'`.
2. Review `docs/migration-v1-to-v2.md` for endpoint-level breaking changes.
3. Rebuild and release the app before the v1 sunset date.

---

## Backend Enforcement

The version check is implemented in `backend/middleware/deprecation.ts`.
The middleware is mounted early in the Express chain (before route handlers)
so all endpoints enforce the same minimum version.

To adjust the minimum supported version, update `MINIMUM_VERSION` in
`backend/middleware/deprecation.ts` and update this document.
