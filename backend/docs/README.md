# PetChain API — OpenAPI Documentation

Complete OpenAPI 3.0 documentation for the PetChain backend API, with interactive Swagger UI, TypeScript client SDK generation, and spec validation.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

This installs `swagger-ui-express`, `express`, and `ts-node` which are required for the docs tooling.

### 2. Serve the interactive Swagger UI

```bash
npm run docs:serve
```

Opens at **http://localhost:3001/api/docs**

The raw OpenAPI JSON is available at **http://localhost:3001/api/docs/openapi.json**

### 3. Validate the spec

```bash
npm run docs:validate
```

Checks for broken `$ref` references, missing `operationId`s, and cross-validates documented endpoints against the `API_ENDPOINTS` constants.

### 4. Generate the TypeScript client SDK

```bash
npm run docs:generate-sdk
```

Outputs a fully-typed Axios client to `backend/docs/sdk/generated/petchain-client.ts`.

---

## Integrating into an existing Express server

```ts
import express from 'express';
import { mountSwaggerUI } from './backend/docs';

const app = express();

// Mount docs at /api/docs (protected by optional API key)
mountSwaggerUI(app, {
  docsPath: '/api/docs',
  apiKey: process.env.DOCS_API_KEY, // optional — omit for public access
});

app.listen(3000);
```

---

## Protecting the docs endpoint

Set the `DOCS_API_KEY` environment variable to require an API key:

```bash
DOCS_API_KEY=my-secret-key npm run docs:serve
```

Clients must then provide the key via:
- Header: `X-Docs-Api-Key: my-secret-key`
- Query param: `?api_key=my-secret-key`

---

## Authentication in Swagger UI

1. Open the Swagger UI at `/api/docs`
2. Click the **Authorize** button (🔒) at the top right
3. Enter your JWT token in the `BearerAuth` field: `Bearer eyJhbGci...`
4. Click **Authorize** — all subsequent requests will include the token

To get a token, use the **POST /auth/login** endpoint in the Authentication section.

---

## File structure

```
backend/docs/
├── README.md                    ← This file
├── index.ts                     ← Public exports
│
├── openapi/
│   ├── spec.ts                  ← Main spec assembler (entry point)
│   └── paths/
│       ├── auth.ts              ← /auth/* endpoints
│       ├── users.ts             ← /users/* endpoints
│       ├── pets.ts              ← /pets/* endpoints
│       ├── medicalRecords.ts    ← /medical-records/* endpoints
│       ├── appointments.ts      ← /appointments/* endpoints
│       ├── medications.ts       ← /medications/* endpoints
│       └── blockchain.ts        ← /blockchain/* endpoints
│
├── schemas/
│   ├── common.ts                ← ApiResponse, ApiError, PaginationMeta
│   ├── auth.ts                  ← Login/Register/Refresh schemas
│   ├── user.ts                  ← User model schemas
│   ├── pet.ts                   ← Pet model schemas
│   ├── medicalRecord.ts         ← MedicalRecord + nested schemas
│   ├── appointment.ts           ← Appointment schemas
│   ├── medication.ts            ← Medication schemas
│   └── blockchain.ts            ← Stellar/blockchain schemas
│
├── server/
│   └── swaggerServer.ts         ← Express + swagger-ui-express setup
│
├── sdk/
│   ├── generateClient.ts        ← TypeScript SDK generator
│   └── generated/               ← Auto-generated output (gitignored)
│       ├── petchain-client.ts   ← Generated TypeScript client
│       └── openapi.json         ← Generated OpenAPI JSON
│
└── validate/
    └── validateSpec.ts          ← Spec validation script
```

---

## API Coverage

| Tag | Endpoints | Auth Required |
|---|---|---|
| Authentication | 8 | Partial (login/register are public) |
| Users | 5 | Yes |
| Pets | 5 | Yes |
| Medical Records | 5 | Yes |
| Appointments | 4 | Yes |
| Medications | 4 | Yes |
| Blockchain | 7 | Yes |
| **Total** | **38** | |

---

## Authentication flows documented

### JWT Bearer (primary)
```
POST /auth/login → { token, refreshToken }
Authorization: Bearer <token>
POST /auth/refresh → { token }  (on 401)
```

### OAuth (social login)
```
POST /auth/oauth/google  → { token, refreshToken }
POST /auth/oauth/apple   → { token, refreshToken }
POST /auth/oauth/facebook → { token, refreshToken }
```

### API Key (server-to-server)
```
X-API-Key: <key>
```

---

## Blockchain verification flow

Medical records are anchored on the Stellar blockchain for tamper-proof integrity:

1. Create record → `POST /medical-records`
2. Compute SHA-256 hash of canonical JSON payload
3. Anchor hash → `POST /blockchain/records/store`
4. Verify integrity → `POST /blockchain/records/verify`
5. Batch verify → `POST /blockchain/records/batch-verify`

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DOCS_PORT` | `3001` | Port for standalone docs server |
| `DOCS_API_KEY` | _(none)_ | API key to protect docs endpoint |
| `API_BASE_URL` | `http://localhost:3000/api` | Backend API base URL |
