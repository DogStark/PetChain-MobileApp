# Configuration and Environment Variables

## Overview

Runtime configuration is validated at app startup before any services start. This ensures:
- Invalid URLs, timeouts, or sample rates are caught immediately
- Production builds **cannot** accidentally fall back to localhost
- All numeric values are validated (no NaN or Infinity)

## Environment Variables

All env vars are resolved in priority order:
1. Explicit env var (if set)
2. Expo `extra.xxx` from `app.config.js`
3. Profile-specific defaults
4. Fail: invalid config throws error (production) or logs warning (dev/staging)

### Required Per Profile

#### Production (`APP_ENV=production`)
- **PROD_API_URL** (required): Absolute HTTPS URL, no localhost
  - Example: `https://api.petchain.app/api`
  - Default: `https://api.petchain.app/api`
  - Validation: must be HTTPS, cannot be localhost, must be absolute
  - Failure: app startup fails hard

- **API_TIMEOUT** (optional, default: `10000`ms)
  - Range: 100–120,000ms
  
- **MONITORING_SAMPLE_RATE** (optional, default: `1.0`)
  - Range: 0.0–1.0

#### Staging (`APP_ENV=staging`)
- **STAGING_API_URL** (optional, default: `https://staging.petchain.app/api`)
  - Can use HTTP (will warn)
  - Validation: soft failure (logs warning, app continues)

#### Development (`APP_ENV=development`)
- **API_BASE_URL** (optional, default: `http://localhost:3000/api`)
  - Can use HTTP, localhost, or any endpoint
  - Validation: soft failure (logs warning, app continues)

### Other Config Variables

| Variable | Default | Range | Notes |
|----------|---------|-------|-------|
| `API_TIMEOUT` | `10000` | 100–120,000 ms | Affects all API requests |
| `MAX_CACHE_SIZE` | `50` | 1–500 MB | Max size of client-side cache |
| `PAGINATION_LIMIT` | `20` | 1–1000 | Default page size for list endpoints |
| `MONITORING_SAMPLE_RATE` | `1.0` | 0.0–1.0 | Fraction of sessions sent to Sentry |
| `SESSION_TIMEOUT_MS` | `1800000` | 1,000–86,400,000 ms | Inactivity timeout (30 min default) |
| `CRASH_FREE_THRESHOLD` | `99.5` | 0–100 | Percentage threshold for alerts |
| `SENTRY_DSN` | (empty) | — | Sentry project DSN (optional) |
| `SENTRY_ENABLE_IN_DEV` | `false` | — | Enable Sentry in dev builds |

## EAS Build Profiles

Profile configuration is in `eas.json`. Each profile sets `APP_ENV`:

```json
{
  "build": {
    "development": { "env": { "APP_ENV": "development" } },
    "staging":     { "env": { "APP_ENV": "staging" } },
    "production":  { "env": { "APP_ENV": "production" } }
  }
}
```

### Building

```bash
# Development (allows localhost, soft validation)
eas build --profile development

# Staging (warns on HTTP, soft validation)
eas build --profile staging

# Production (HTTPS required, hard validation, app won't start if invalid)
PROD_API_URL=https://api.petchain.app/api eas build --profile production
```

## Validation and Failure Modes

### Production
- Configuration errors **throw immediately** and prevent app startup
- No fallback to localhost or insecure endpoints
- All URLs must be HTTPS
- All numeric values must be finite (no NaN, Infinity)

### Staging
- Configuration errors log warnings but app continues
- HTTP URLs trigger a warning (soft enforcement)
- Useful for testing against staging APIs

### Development
- Configuration errors log warnings but app continues
- HTTP and localhost allowed
- Most lenient for local development

## Schema

The runtime schema is validated in `src/config/schema.ts`:
- `validateRuntimeConfig(config, env)` → `ValidationResult`
- `shouldFailHardOnConfigError(env)` → `boolean`

See `src/config/__tests__/config.validation.test.ts` for validation examples.

## Migration Guide

If you see `[Config] Validation failed` errors:

1. **Production**: set `PROD_API_URL` to your HTTPS API endpoint
   ```bash
   PROD_API_URL=https://api.petchain.app/api eas build --profile production
   ```

2. **Staging**: set `STAGING_API_URL` if using non-standard endpoint
   ```bash
   STAGING_API_URL=https://staging-custom.petchain.app/api eas build --profile staging
   ```

3. **Development**: use default `http://localhost:3000/api` or set `API_BASE_URL`
   ```bash
   API_BASE_URL=http://my-dev-server:3000/api npm run start
   ```

4. **Timeouts/limits**: ensure all numeric values are in valid ranges (see table above)

## Security Notes

- No tokens, secrets, or PII are logged in validation errors
- Production validation is strict by design — harder to misconfigure
- Config validation runs at startup before any async services init
- See `src/config/security.ts` for certificate pinning configuration
