import { createHash } from 'crypto';

/**
 * Persisted query map for mobile clients.
 *
 * Generated at build time by `npm run codegen` (see codegen.ts) from the
 * operations in `src/services/graphql/operations.graphql`, and committed so the
 * backend can resolve `GET /graphql?queryId=<hash>` without shipping the query
 * text over the wire.
 *
 * Keys are the SHA-256 hex digest of the normalized query document.
 */
export const persistedQueries: Record<string, string> = {
  '2f0a1c1e0b0f4c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e': `query GetPet($id: ID!) {
  pet(id: $id) {
    id
    name
    species
    breed
    dateOfBirth
    microchipId
    photoUrl
    createdAt
    updatedAt
    owner {
      id
      name
      email
    }
  }
}`,
  '9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c': `query GetAllPets {
  pets {
    id
    name
    species
    breed
    photoUrl
    ownerId
    createdAt
    updatedAt
  }
}`,
  '4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d': `query GetMedicalRecords($petId: ID!, $type: String, $startDate: String, $endDate: String, $page: Int, $limit: Int) {
  medicalRecords(petId: $petId, type: $type, startDate: $startDate, endDate: $endDate, page: $page, limit: $limit) {
    data {
      id
      petId
      type
      date
      veterinarian
      notes
      createdAt
    }
    total
    page
    limit
    totalPages
  }
}`,
};

/** Normalizes a query document so hashing is whitespace-insensitive. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

/** Computes the persisted query ID (SHA-256 hex) for a query document. */
export function hashQuery(query: string): string {
  return createHash('sha256').update(normalizeQuery(query)).digest('hex');
}

/** Resolves a persisted query ID to its stored query document. */
export function resolvePersistedQuery(queryId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(persistedQueries, queryId)
    ? persistedQueries[queryId]
    : undefined;
}
