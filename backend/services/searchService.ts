import { Client } from '@elastic/elasticsearch';

const client = new Client({
  node: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
});

export const INDICES = {
  petRecords: 'pet_records',
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
  await client.index({ index, id, document: doc });
}

export async function deleteDocument(index: SearchIndex, id: string): Promise<void> {
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
}

// ─── Index all existing data (initial sync) ───────────────────────────────────

export async function ensureIndices(): Promise<void> {
  for (const index of Object.values(INDICES)) {
    const exists = await client.indices.exists({ index });
    if (!exists) {
      await client.indices.create({ index });
    }
  }
}
