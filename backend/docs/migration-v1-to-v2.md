# Migrating from API v1 to v2

## Timeline

| Date | Event |
|------|-------|
| 2026-06-01 | v2 launched, v1 deprecated |
| 2026-12-01 | v1 sunset (removed) |

v1 will continue to work until **1 December 2026**. Every v1 response includes:

```
Deprecation: true
Sunset: Mon, 01 Dec 2026 00:00:00 GMT
Link: </api/v2>; rel="successor-version"
```

---

## Base URL change

| Version | Base URL |
|---------|----------|
| v1 (deprecated) | `https://api.petchain.app/api/v1` |
| v2 (current) | `https://api.petchain.app/api/v2` |

The legacy `/api` prefix still routes to v1 behaviour but will be removed alongside v1.

---

## Breaking changes in v2

### `GET /pets` — paginated envelope

**v1** returned a flat array:

```json
{ "success": true, "data": [ { "id": "...", ... } ] }
```

**v2** wraps the array in a pagination envelope:

```json
{
  "success": true,
  "data": {
    "data": [ { "id": "...", ... } ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

Supports `?page=` and `?limit=` query params.

### `GET /pets/:id` — field renames

| v1 field | v2 field | Notes |
|----------|----------|-------|
| `dateOfBirth` | `birthDate` | ISO 8601 date string |
| `owner` | `ownerInfo` | Same shape `{ id, name, email }` |

**v1 response:**
```json
{ "id": "p-1", "dateOfBirth": "2020-01-15", "owner": { "id": "u-1", "name": "Alice" } }
```

**v2 response:**
```json
{ "id": "p-1", "birthDate": "2020-01-15", "ownerInfo": { "id": "u-1", "name": "Alice" } }
```

### `POST /pets` — request body field rename

Send `birthDate` instead of `dateOfBirth`.

### `DELETE /pets/:id` — status code change

| v1 | v2 |
|----|----|
| `200 { "success": true, "data": null }` | `204 No Content` |

---

## Non-breaking routes (identical in v1 and v2)

- `/users`
- `/medical-records`
- `/appointments`
- `/medications`
- `/analytics`

---

## Migration checklist

- [ ] Update base URL from `/api` or `/api/v1` → `/api/v2`
- [ ] Update pet list consumers: unwrap `data.data` array, use `data.total` / `data.page`
- [ ] Rename `pet.dateOfBirth` → `pet.birthDate` in all read paths
- [ ] Rename `pet.owner` → `pet.ownerInfo` in all read paths
- [ ] Update `POST /pets` body: `dateOfBirth` → `birthDate`
- [ ] Handle `DELETE /pets/:id` returning `204` (no body)
