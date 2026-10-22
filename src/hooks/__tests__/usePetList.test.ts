import { act, renderHook } from '@testing-library/react-native';

import { usePetList } from '../usePetList';
import { getAllPets, type Pet } from '../../services/petService';

jest.mock('../../services/petService', () => ({
  getAllPets: jest.fn(),
}));

/** Helper to build a mock pet */
function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: 'pet-001',
    name: 'Buddy',
    species: 'dog',
    breed: 'Golden Retriever',
    dateOfBirth: '2020-03-15',
    weightKg: 25,
    ownerId: 'user-001',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('usePetList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Fetching ───────────────────────────────────────────────────────────

  it('fetches pets on mount and sets isLoading → false', async () => {
    const mockData = [makePet()];
    (getAllPets as jest.Mock).mockResolvedValue(mockData);

    const { result } = renderHook(() => usePetList());

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.pets).toEqual(mockData);
    expect(getAllPets).toHaveBeenCalledTimes(1);
  });

  it('sets error when fetch fails', async () => {
    (getAllPets as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePetList());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.isLoading).toBe(false);
  });

  // ── Pagination ─────────────────────────────────────────────────────────

  it('returns the first page and tracks hasMore', async () => {
    const data = Array.from({ length: 25 }, (_, i) =>
      makePet({ id: `pet-${i}`, name: `Pet ${i}` }),
    );
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() => usePetList({ pageSize: 10 }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pets).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(25);
  });

  it('fetchMore loads the next page', async () => {
    const data = Array.from({ length: 25 }, (_, i) =>
      makePet({ id: `pet-${i}`, name: `Pet ${i}` }),
    );
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() => usePetList({ pageSize: 10 }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.fetchMore();
    });

    expect(result.current.pets).toHaveLength(20);

    act(() => {
      result.current.fetchMore();
    });

    expect(result.current.pets).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);
  });

  it('fetchMore is a no-op when hasMore is false', async () => {
    const data = [makePet()];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() => usePetList());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasMore).toBe(false);

    act(() => {
      result.current.fetchMore();
    });

    expect(result.current.pets).toHaveLength(1);
  });

  it('returns the full list when pageSize is larger than the dataset', async () => {
    const data = [makePet({ id: '1' }), makePet({ id: '2' })];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() => usePetList({ pageSize: 100 }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pets).toHaveLength(2);
    expect(result.current.hasMore).toBe(false);
  });

  // ── Filtering ──────────────────────────────────────────────────────────

  it('filters by species', async () => {
    const data = [
      makePet({ id: '1', species: 'dog', name: 'Rex' }),
      makePet({ id: '2', species: 'cat', name: 'Whiskers' }),
      makePet({ id: '3', species: 'dog', name: 'Buddy' }),
    ];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() => usePetList({ species: 'dog' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pets).toHaveLength(2);
    expect(result.current.pets.every((p) => p.species === 'dog')).toBe(true);
  });

  it('filters by search query (name match)', async () => {
    const data = [
      makePet({ id: '1', name: 'Rex' }),
      makePet({ id: '2', name: 'Buddy' }),
    ];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() => usePetList({ search: 'rex' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pets).toHaveLength(1);
    expect(result.current.pets[0].name).toBe('Rex');
  });

  it('filters by search query (breed match)', async () => {
    const data = [
      makePet({ id: '1', breed: 'Golden Retriever', name: 'Buddy' }),
      makePet({ id: '2', breed: 'Poodle', name: 'Max' }),
    ];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() => usePetList({ search: 'poodle' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pets).toHaveLength(1);
    expect(result.current.pets[0].breed).toBe('Poodle');
  });

  it('combines species and search filters', async () => {
    const data = [
      makePet({ id: '1', species: 'dog', name: 'Rex', breed: 'German Shepherd' }),
      makePet({ id: '2', species: 'dog', name: 'Buddy', breed: 'Golden Retriever' }),
      makePet({ id: '3', species: 'cat', name: 'Rex', breed: 'Siamese' }),
    ];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result } = renderHook(() =>
      usePetList({ species: 'dog', search: 'rex' }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pets).toHaveLength(1);
    expect(result.current.pets[0].id).toBe('1');
  });

  // ── Caching ────────────────────────────────────────────────────────────

  it('reuses cached results on re-render with same options', async () => {
    const data = [makePet()];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result, rerender } = renderHook(
      (props) => usePetList(props),
      { initialProps: { species: 'dog' } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getAllPets).toHaveBeenCalledTimes(1);

    // Re-render with the same options — should not re‑fetch
    rerender({ species: 'dog' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getAllPets).toHaveBeenCalledTimes(1);
  });

  it('applies filters client-side without re‑fetching', async () => {
    const data = [
      makePet({ id: '1', species: 'dog', name: 'Rex' }),
      makePet({ id: '2', species: 'cat', name: 'Whiskers' }),
    ];
    (getAllPets as jest.Mock).mockResolvedValue(data);

    const { result, rerender } = renderHook(
      (props) => usePetList(props),
      { initialProps: { species: 'dog' as const } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.pets).toHaveLength(1);
    expect(result.current.pets[0].species).toBe('dog');

    // Change filter → should NOT re‑fetch (getAllPets already has all data)
    rerender({ species: 'cat' as const });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getAllPets).toHaveBeenCalledTimes(1);
    expect(result.current.pets).toHaveLength(1);
    expect(result.current.pets[0].species).toBe('cat');
  });

  // ── Refetch ────────────────────────────────────────────────────────────

  it('refetch forces a fresh API call', async () => {
    const initial = [makePet({ id: '1', name: 'Old' })];
    const refreshed = [makePet({ id: '2', name: 'New' })];
    (getAllPets as jest.Mock)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(refreshed);

    const { result } = renderHook(() => usePetList());

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.pets[0].name).toBe('Old');

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.pets[0].name).toBe('New');
    expect(getAllPets).toHaveBeenCalledTimes(2);
  });

  // ── Cleanup ────────────────────────────────────────────────────────────

  it('does not update state after unmount', async () => {
    (getAllPets as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { result, unmount } = renderHook(() => usePetList());

    expect(result.current.isLoading).toBe(true);

    unmount();

    // Should not throw or attempt setState after unmount
  });
});
