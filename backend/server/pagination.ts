/**
 * Cursor-based pagination helpers (Issue #1347).
 *
 * Cursors are opaque base64url-encoded JSON payloads holding the sort key of the
 * last row on the page plus a tie-breaker id. Because the cursor encodes the
 * position in the sort order (not an offset), inserting new records mid-page
 * does not shift the rows returned by the next page.
 */

export interface CursorPayload {
  /** Primary sort key of the boundary row (ISO date or sortable string). */
  k: string;
  /** Tie-breaker id of the boundary row. */
  id: string;
}

export interface CursorPage<T> {
  data: T[];
  limit: number;
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorPayload).k === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return { k: (parsed as CursorPayload).k, id: (parsed as CursorPayload).id };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseLimit(raw: unknown, fallback = 20, max = 100): number {
  return Math.min(max, Math.max(1, Number(raw) || fallback));
}

/**
 * Slices an already-sorted list using a cursor.
 *
 * @param rows   Rows sorted by `keyOf` ascending.
 * @param cursor Decoded cursor (exclusive lower bound) or null for the first page.
 * @param limit  Page size.
 */
export function paginateByCursor<T>(
  rows: T[],
  cursor: CursorPayload | null,
  limit: number,
  keyOf: (row: T) => string,
  idOf: (row: T) => string,
): CursorPage<T> {
  let start = 0;
  if (cursor) {
    const idx = rows.findIndex((row) => {
      const key = keyOf(row);
      return key > cursor.k || (key === cursor.k && idOf(row) > cursor.id);
    });
    start = idx === -1 ? rows.length : idx;
  }

  const slice = rows.slice(start, start + limit);
  const hasMore = start + limit < rows.length;

  const nextCursor =
    hasMore && slice.length > 0
      ? encodeCursor({ k: keyOf(slice[slice.length - 1]), id: idOf(slice[slice.length - 1]) })
      : null;

  const prevCursor =
    start > 0 && slice.length > 0
      ? encodeCursor({ k: keyOf(slice[0]), id: idOf(slice[0]) })
      : null;

  return { data: slice, limit, nextCursor, prevCursor, hasMore };
}
