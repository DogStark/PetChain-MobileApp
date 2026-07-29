import { useCallback, useState } from 'react';

export type PaginatedFetch<T> = (page: number) => Promise<T[]>;

export interface UsePaginationResult<T> {
  data: T[];
  page: number;
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  reset: () => void;
}

export function usePagination<T>(fetchPage: PaginatedFetch<T>): UsePaginationResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);
    try {
      const nextData = await fetchPage(page);

      setData((currentData) => [...currentData, ...nextData]);
      setPage((currentPage) => currentPage + 1);
      setHasMore(nextData.length > 0);
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage, hasMore, isLoading, page]);

  const reset = useCallback(() => {
    setData([]);
    setPage(1);
    setIsLoading(false);
    setHasMore(true);
  }, []);

  return { data, page, isLoading, hasMore, loadMore, reset };
}

export default usePagination;
