# API Services Documentation

This document describes the client-side API service layer (`src/services/`) and the backend endpoints they consume (`backend/services/`, `backend/docs/openapi.yaml`). It is a starting reference for contributors — see `backend/docs/openapi.yaml` / `backend/docs/openapi.json` for the generated, authoritative OpenAPI spec.

## Overview

- All HTTP calls from the mobile app go through `src/services/apiClient.ts`, an Axios instance configured with:
  - Base URL / timeout from `src/config`
  - Auth token attachment and refresh (`authService.ts`)
  - SSL certificate pinning (`certPinning.ts`, `config/security.ts`)
  - Request/response interceptors (`middleware/apiInterceptors.ts`)
  - Error logging (`utils/errorLogger.ts`) and performance timing (`utils/performance.ts`)
- Domain-specific services (e.g. `appointmentService.ts`, `claimsService.ts`, `medicalRecordService.ts`) wrap `apiClient` calls with typed request/response shapes and expose functions consumed by screens/hooks.

## Service Layer Conventions

Each service module in `src/services/` typically follows this shape:

```ts
export async function getX(params): Promise<XResponse> { ... }
export async function createX(payload): Promise<XResponse> { ... }
export async function updateX(id, payload): Promise<XResponse> { ... }
export async function deleteX(id): Promise<void> { ... }
```

- **Request shapes**: defined as TypeScript interfaces/types colocated in the service file or in `src/types/`.
- **Response shapes**: mirrored from backend DTOs; kept in sync with `backend/types/`.
- **Errors**: services do not swallow errors — they let Axios errors propagate (or normalize them via `errorLogger`) so calling hooks/screens can handle UI state (loading/error/retry).

## Key Services (non-exhaustive)

| Service | Responsibility |
|---|---|
| `apiClient.ts` | Shared Axios instance, interceptors, SSL pinning, retries |
| `authService.ts` | Login, token refresh, logout |
| `appointmentService.ts` | Vet appointment CRUD and scheduling |
| `claimsService.ts` | Insurance claim submission/status |
| `medicalRecordService.ts`, `medicalRecordSharingService.ts` | Medical record CRUD and sharing/co-owner access |
| `medicationService.ts`, `dosageApprovalService.ts`, `drugInteractionService.ts` | Medication tracking, dosage approval workflow, interaction checks |
| `documentService.ts` | Document vault uploads/downloads |
| `notificationService.ts` | Push notification registration/handling |
| `blockchainService.ts`, `blockchainIntegration.ts`, `blockchainEventService.ts` | On-chain record anchoring and event sync |
| `cloudSyncService.ts`, `backgroundTaskService.ts` | Background/offline sync orchestration |
| `localDB.ts` | Local persistence (offline cache / queue) |
| `analyticsService.ts`, `auditService.ts`, `auditTrailService.ts` | Usage analytics and audit logging |

## Backend Endpoints

The backend (`backend/server`, `backend/services`) exposes REST endpoints consumed by the services above. For the full, generated list of endpoints, request/response schemas, and error codes, see:

- `backend/docs/openapi.yaml` / `backend/docs/openapi.json` — machine-readable spec
- `backend/docs/README.md` — human-readable index
- `backend/docs/schemas/` — shared schema definitions
- `backend/docs/sdk/` — generated client SDK docs

## Error Codes

Standard error responses follow the shape:

```json
{
  "error": {
    "code": "STRING_ERROR_CODE",
    "message": "Human readable message",
    "details": { }
  }
}
```

Common HTTP status codes used across services:

| Status | Meaning |
|---|---|
| 400 | Validation error / malformed request |
| 401 | Missing or invalid auth token |
| 403 | Authenticated but not authorized for this resource |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate resource, stale sync) |
| 422 | Business-rule validation failure |
| 429 | Rate limited |
| 500 | Unexpected server error |

Refer to `backend/docs/openapi.yaml` for endpoint-specific error codes and to individual `backend/services/*.ts` files for domain-specific error handling.

## Contributing

When adding or changing a service function:

1. Add/update the TypeScript request and response types.
2. Keep the function name and shape consistent with sibling functions in the same service file.
3. Update the corresponding backend OpenAPI spec if the endpoint contract changes.
4. Add or update tests under `tests/__tests__` or `src/__tests__` (see `docs/TESTING.md`).
