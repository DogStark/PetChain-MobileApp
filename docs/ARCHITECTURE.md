# Mobile App Architecture

This document gives a high-level overview of the PetChain mobile app's architecture for contributors: data flow, service layer responsibilities, offline strategy, and state management.

## High-Level Layers

```
Screens (src/screens)
   ↓ uses
Hooks / Context (src/hooks, src/context)
   ↓ calls
Services (src/services)
   ↓ HTTP / local DB
apiClient.ts (Axios + interceptors)  ←→  localDB.ts / cacheManager (offline store)
   ↓
Backend API (backend/server, backend/services)
```

- **Screens** (`src/screens/`): UI components/pages, one per app view (e.g. `AppointmentScreen.tsx`, `ClinicalNotesScreen.tsx`). Screens should stay presentational and delegate data fetching/mutation to hooks or context.
- **Context** (`src/context/`): Global app state shared across the tree — `AuthContext`, `PetContext`, `ThemeContext`, `ToastContext`, `OnboardingContext`. These wrap services and expose simplified state + actions to screens.
- **Hooks** (`src/hooks/`): Encapsulate reusable stateful logic (data fetching, subscriptions, derived state) built on top of services/context.
- **Services** (`src/services/`): The data-access layer. Each service owns one domain (appointments, claims, medical records, medications, documents, notifications, blockchain, analytics, etc.) and is the only layer allowed to talk to `apiClient`, `localDB`, or third-party SDKs directly. See `docs/API_SERVICES.md` for details.
- **Middleware** (`src/middleware/`): Cross-cutting request/response concerns (e.g. `apiInterceptors.ts` for auth headers, retries, error normalization).
- **Utils** (`src/utils/`): Stateless helpers (error logging, performance timing, formatting, validation).

## Data Flow

1. A screen renders and calls a hook (or reads context state).
2. The hook/context calls into a service function (e.g. `appointmentService.getUpcoming()`).
3. The service function either:
   - Calls `apiClient` to hit the backend REST API, or
   - Reads/writes to the local store (`localDB.ts`, `cacheManager.ts`/`cacheService.ts`) when offline or for cached data.
4. Responses are normalized into typed shapes and returned up through the hook/context to the screen, which re-renders based on the new state.
5. Side effects (analytics events, audit logs, notifications) are fired from the service layer via `analyticsService.ts`, `auditService.ts`/`auditTrailService.ts`, and `notificationService.ts` rather than from screens directly.

## Service Layer Responsibilities

- Own request/response typing for their domain.
- Own error handling and translate backend error codes into app-level errors.
- Own caching/offline fallback for their domain's data (in conjunction with `localDB`/`cacheManager`).
- Never import from `src/screens/` — dependency direction is strictly screens → context/hooks → services.

## Offline Strategy

- **Local persistence**: `localDB.ts` provides on-device storage for records that must be available offline (pets, medical records, appointments, etc.).
- **Caching**: `cacheService.ts` / `cacheManager.ts` provide short-lived caches for API responses to reduce redundant network calls and support instant UI on reconnect.
- **Background sync**: `backgroundTaskService.ts` and `cloudSyncService.ts` reconcile local changes with the backend when connectivity is restored, handling conflict resolution and retry/backoff.
- **Queueing writes**: Mutations made while offline are expected to be queued locally and flushed by the sync service rather than failing outright — check the specific service (e.g. `medicalRecordService.ts`, `claimsService.ts`) for its queueing behavior before assuming synchronous writes.
- **Blockchain anchoring**: `blockchainService.ts` / `blockchainEventService.ts` operate asynchronously against on-chain state and are designed to tolerate delayed confirmation rather than blocking the UI.

## State Management

- **Global/shared state**: React Context (`src/context/`) for auth session, active pet, theme, toasts, and onboarding progress.
- **Local/component state**: Standard React state (`useState`/`useReducer`) within screens/hooks for UI-only concerns.
- **Server/cache state**: Owned by the service layer plus `cacheManager`/`localDB` rather than duplicated in Context, to avoid state drift between screens.
- **Cross-cutting concerns** (errors, performance) are handled via `utils/errorLogger.ts` and `utils/performance.ts`, invoked from the service layer so all data-access paths report consistently.

## Contributing

When adding a new feature that needs data:

1. Add or extend a service in `src/services/` rather than calling `apiClient`/`localDB` from a screen or hook directly.
2. Decide whether the data needs offline support; if so, integrate with `localDB`/`cacheManager` and the sync services.
3. Expose the feature to the UI via a hook or context, not directly from the service.
4. See `docs/API_SERVICES.md` for API contract conventions and `docs/TESTING.md` for how to test each layer.
