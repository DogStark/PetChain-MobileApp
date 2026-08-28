# PetChain CSV Import Schema

This document defines the CSV format accepted by the PetChain bulk import tool.

Header row is required. Columns (order-insensitive, case-insensitive):

- `petId` (required): ID of the pet in the system (e.g., `p-demo-1`).
- `vetId` (required): ID of the veterinary clinic or practitioner (e.g., `v-demo-1`).
- `type` (required): One of `checkup`, `vaccination`, `surgery`, `treatment`, `other`.
- `visitDate` (required): ISO date `YYYY-MM-DD` representing the visit date.
- `diagnosis` (optional): Short text describing diagnosis.
- `treatment` (optional): Short text describing treatment given.
- `notes` (optional): Freeform notes.
- `nextVisitDate` (optional): ISO date `YYYY-MM-DD` for next scheduled visit.

Behavior:

- All rows are validated before final import. Invalid rows are skipped and reported with row number, field, and message.
- Partial imports are supported: valid rows are imported while invalid rows are skipped.
- All successfully imported records are anchored to the Stellar blockchain in a single batch transaction. The API returns the batch transaction hash.

Example CSV:

```
petId,vetId,type,visitDate,diagnosis,treatment,notes,nextVisitDate
p-demo-1,v-demo-1,vaccination,2026-06-01,Annual vaccines,Rabies vaccine,No issues,2027-06-01
p-demo-1,v-demo-1,checkup,2026-06-02,General exam,,Healthy,
```

API:

- POST `/api/v1/import/csv` — JSON body `{ "csv": "..." }` returns import result with `imported`, `skipped`, `errors`, and `txHashes`.
