import { Client } from '@elastic/elasticsearch';

import config from '../config';
import { query as dbQuery } from '../src/db';

const client: Client | null = config.elasticsearch.url
  ? new Client({ node: config.elasticsearch.url })
  : null;

export const INDICES = {
  pets: 'pets',
  medicalRecords: 'medical_records',
  medications: 'medications',
  appointments: 'appointments',
} as const;

export type SearchIndex = (typeof INDICES)[keyof typeof INDICES];

export interface SearchHit {
  id: string;
  index: SearchIndex;
  score: number;
  source: Record<string, unknown>;
  highlights: Record<string, string[]>;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

// ─── Index sync helpers ───────────────────────────────────────────────────────

export async function indexDocument(
  index: SearchIndex,
  id: string,
  doc: Record<string, unknown>,
): Promise<void> {
  if (!client) return;
  await client.index({ index, id, document: doc });
}

export async function deleteDocument(index: SearchIndex, id: string): Promise<void> {
  if (!client) return;
  await client.delete({ index, id }).catch(() => {
    /* ignore 404 */
  });
}

// ─── Full-text search ─────────────────────────────────────────────────────────

export async function search(
  query: string,
  options: {
    indices?: SearchIndex[];
    filters?: Record<string, unknown>;
    from?: number;
    size?: number;
  } = {},
): Promise<SearchResult> {
  const { indices = Object.values(INDICES), filters = {}, from = 0, size = 20 } = options;

  const filterClauses = Object.entries(filters).map(([field, value]) => ({
    term: { [field]: value },
  }));

  if (!client) {
    return postgresFallback(query, options);
  }

  try {
    const response = await client.search({
      index: indices.join(','),
      from,
      size,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['*'],
                fuzziness: 'AUTO',
                type: 'best_fields',
              },
            },
          ],
          filter: filterClauses as never,
        },
      },
      highlight: {
        fields: { '*': {} },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
    });

    const hits: SearchHit[] = (
      response.hits.hits as Array<{
        _id: string;
        _index: string;
        _score: number | null;
        _source: Record<string, unknown>;
        highlight?: Record<string, string[]>;
      }>
    ).map((h) => ({
      id: h._id,
      index: h._index as SearchIndex,
      score: h._score ?? 0,
      source: h._source,
      highlights: h.highlight ?? {},
    }));

    const total =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : (response.hits.total as { value: number }).value;

    return { hits, total };
  } catch {
    return postgresFallback(query, options);
  }
}

async function postgresFallback(
  queryText: string,
  options: {
    indices?: SearchIndex[];
    filters?: Record<string, unknown>;
    from?: number;
    size?: number;
  },
): Promise<SearchResult> {
  const indices = options.indices ?? [INDICES.pets, INDICES.medicalRecords];
  const requested = new Set(indices);
  const from = options.from ?? 0;
  const size = options.size ?? 20;
  const hits: SearchHit[] = [];
  let total = 0;

  if (requested.has(INDICES.pets)) {
    const result = await dbQuery(
      `SELECT p.*, plainto_tsquery('english', $1) AS query
         FROM pets p
        WHERE to_tsvector('english', coalesce(p.name, '') || ' ' || coalesce(p.species, '') || ' ' || coalesce(p.breed, '')) @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank(to_tsvector('english', coalesce(p.name, '') || ' ' || coalesce(p.species, '') || ' ' || coalesce(p.breed, '')), plainto_tsquery('english', $1)) DESC
        OFFSET $2 LIMIT $3`,
      [queryText, from, size],
    );
    total += result.rowCount ?? result.rows.length;
    for (const row of result.rows) {
      hits.push({ id: String(row.id), index: INDICES.pets, score: 1, source: row, highlights: {} });
    }
  }

  if (requested.has(INDICES.medicalRecords)) {
    const result = await dbQuery(
      `SELECT mr.*
         FROM medical_records mr
        WHERE to_tsvector('english', coalesce(mr.type, '') || ' ' || coalesce(mr.diagnosis, '') || ' ' || coalesce(mr.treatment, '') || ' ' || coalesce(mr.notes, '')) @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank(to_tsvector('english', coalesce(mr.type, '') || ' ' || coalesce(mr.diagnosis, '') || ' ' || coalesce(mr.treatment, '') || ' ' || coalesce(mr.notes, '')), plainto_tsquery('english', $1)) DESC
        OFFSET $2 LIMIT $3`,
      [queryText, from, size],
    );
    total += result.rowCount ?? result.rows.length;
    for (const row of result.rows) {
      hits.push({
        id: String(row.id),
        index: INDICES.medicalRecords,
        score: 1,
        source: row,
        highlights: {},
      });
    }
  }

  return { hits: hits.slice(0, size), total };
}

// ─── Index all existing data (initial sync) ───────────────────────────────────

const INDEX_MAPPINGS: Record<SearchIndex, Record<string, unknown>> = {
  [INDICES.pets]: {
    properties: {
      name: { type: 'text' },
      species: { type: 'keyword' },
      breed: { type: 'text' },
      date_of_birth: { type: 'date' },
      microchip_id: { type: 'keyword' },
      owner_id: { type: 'keyword' },
    },
  },
  [INDICES.medicalRecords]: {
    properties: {
      pet_id: { type: 'keyword' },
      vet_id: { type: 'keyword' },
      type: { type: 'text' },
      diagnosis: { type: 'text' },
      treatment: { type: 'text' },
      notes: { type: 'text' },
      visit_date: { type: 'date' },
      next_visit_date: { type: 'date' },
    },
  },
  [INDICES.medications]: {
    properties: {
      pet_id: { type: 'keyword' },
      name: { type: 'text' },
      dosage: { type: 'text' },
      frequency: { type: 'text' },
    },
  },
  [INDICES.appointments]: {
    properties: {
      pet_id: { type: 'keyword' },
      vet_id: { type: 'keyword' },
      date: { type: 'date' },
      notes: { type: 'text' },
    },
  },
};

export async function ensureIndices(): Promise<void> {
  if (!client) return;

  for (const index of Object.values(INDICES)) {
    const exists = await client.indices.exists({ index });
    if (!exists) {
      await client.indices.create({
        index,
        mappings: INDEX_MAPPINGS[index],
      });
    }
  }

  if (await client.indices.exists({ index: INDICES.pets })) {
    const pets = await dbQuery('SELECT * FROM pets');
    for (const pet of pets.rows) await indexDocument(INDICES.pets, String(pet.id), pet);
  }

  if (await client.indices.exists({ index: INDICES.medicalRecords })) {
    const records = await dbQuery('SELECT * FROM medical_records');
    for (const record of records.rows) {
      await indexDocument(INDICES.medicalRecords, String(record.id), record);
    }
  }
}
