export interface PaginationMeta {
  currentPage?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
  nextCursor?: string | null;
  previousCursor?: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

type HeaderValue = string | number | null | undefined;
type HeadersLike =
  | Headers
  | Record<string, HeaderValue>
  | {
      headers?: Headers | Record<string, HeaderValue>;
    };

const readHeader = (source: HeadersLike | undefined, name: string): string | undefined => {
  if (!source) return undefined;

  const headers = 'headers' in source && source.headers ? source.headers : source;
  const lowerName = name.toLowerCase();

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const record = headers as Record<string, HeaderValue>;
  const value = record[name] ?? record[lowerName];

  return value === null || value === undefined ? undefined : String(value);
};

const toNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseCursorFromLink = (linkHeader: string | undefined, rel: string): string | null => {
  if (!linkHeader) return null;

  const link = linkHeader
    .split(',')
    .find((entry) => entry.includes(`rel="${rel}"`) || entry.includes(`rel=${rel}`));
  const urlMatch = link?.match(/<([^>]+)>/);
  if (!urlMatch) return null;

  try {
    const url = new URL(urlMatch[1]);
    return url.searchParams.get('cursor') ?? url.searchParams.get('pageToken');
  } catch {
    return null;
  }
};

export const calculateOffset = (page: number, pageSize: number): number => {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(0, pageSize);

  return (safePage - 1) * safePageSize;
};

export const getNextPage = (currentPage: number, totalPages: number): number | null => {
  if (currentPage >= totalPages) return null;

  return currentPage + 1;
};

export const createPaginationMeta = (response: HeadersLike): PaginationMeta => {
  const currentPage = toNumber(readHeader(response, 'x-page'));
  const pageSize =
    toNumber(readHeader(response, 'x-page-size')) ?? toNumber(readHeader(response, 'x-per-page'));
  const totalItems =
    toNumber(readHeader(response, 'x-total-count')) ??
    toNumber(readHeader(response, 'x-total-items'));
  const totalPages =
    toNumber(readHeader(response, 'x-total-pages')) ??
    (totalItems !== undefined && pageSize ? Math.ceil(totalItems / pageSize) : undefined);
  const nextCursor =
    readHeader(response, 'x-next-cursor') ??
    parseCursorFromLink(readHeader(response, 'link'), 'next');
  const previousCursor =
    readHeader(response, 'x-previous-cursor') ??
    parseCursorFromLink(readHeader(response, 'link'), 'prev');

  return {
    currentPage,
    pageSize,
    totalItems,
    totalPages,
    nextCursor,
    previousCursor,
    hasNextPage:
      Boolean(nextCursor) ||
      (currentPage !== undefined && totalPages !== undefined && currentPage < totalPages),
    hasPreviousPage: Boolean(previousCursor) || (currentPage !== undefined && currentPage > 1),
  };
};

export const hasNextPage = (
  meta: Pick<PaginationMeta, 'hasNextPage'> | PaginationMeta,
): boolean => {
  return Boolean(meta.hasNextPage);
};
