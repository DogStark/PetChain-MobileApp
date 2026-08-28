import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getRecentSearches,
  addRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
  filterSuggestions,
  QUICK_ACTIONS,
} from '../searchSuggestionsService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockGet = AsyncStorage.getItem as jest.Mock;
const mockSet = AsyncStorage.setItem as jest.Mock;
const mockRemove = AsyncStorage.removeItem as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getRecentSearches', () => {
  it('returns empty array when nothing stored', async () => {
    mockGet.mockResolvedValue(null);
    expect(await getRecentSearches()).toEqual([]);
  });

  it('returns parsed array', async () => {
    mockGet.mockResolvedValue(JSON.stringify(['Buddy', 'Whiskers']));
    expect(await getRecentSearches()).toEqual(['Buddy', 'Whiskers']);
  });
});

describe('addRecentSearch', () => {
  it('prepends new query and deduplicates', async () => {
    mockGet.mockResolvedValue(JSON.stringify(['Buddy']));
    await addRecentSearch('Whiskers');
    expect(mockSet).toHaveBeenCalledWith('@search_recent', JSON.stringify(['Whiskers', 'Buddy']));
  });

  it('moves existing query to front', async () => {
    mockGet.mockResolvedValue(JSON.stringify(['Buddy', 'Whiskers']));
    await addRecentSearch('Whiskers');
    expect(mockSet).toHaveBeenCalledWith('@search_recent', JSON.stringify(['Whiskers', 'Buddy']));
  });

  it('ignores blank queries', async () => {
    await addRecentSearch('   ');
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('caps at 8 entries', async () => {
    const existing = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    mockGet.mockResolvedValue(JSON.stringify(existing));
    await addRecentSearch('new');
    const saved = JSON.parse(mockSet.mock.calls[0][1] as string) as string[];
    expect(saved).toHaveLength(8);
    expect(saved[0]).toBe('new');
  });
});

describe('removeRecentSearch', () => {
  it('removes the specified query', async () => {
    mockGet.mockResolvedValue(JSON.stringify(['Buddy', 'Whiskers']));
    const result = await removeRecentSearch('Buddy');
    expect(result).toEqual(['Whiskers']);
    expect(mockSet).toHaveBeenCalledWith('@search_recent', JSON.stringify(['Whiskers']));
  });
});

describe('clearRecentSearches', () => {
  it('removes the storage key', async () => {
    await clearRecentSearches();
    expect(mockRemove).toHaveBeenCalledWith('@search_recent');
  });
});

describe('filterSuggestions', () => {
  const recents = ['Buddy', 'Bulldog', 'Whiskers', 'Vet visit'];

  it('returns all recents when query is empty', () => {
    expect(filterSuggestions(recents, '')).toEqual(recents);
  });

  it('filters by prefix (case-insensitive)', () => {
    expect(filterSuggestions(recents, 'bu')).toEqual(['Buddy', 'Bulldog']);
  });

  it('returns empty when no match', () => {
    expect(filterSuggestions(recents, 'xyz')).toEqual([]);
  });
});

describe('QUICK_ACTIONS', () => {
  it('has at least 4 actions with required fields', () => {
    expect(QUICK_ACTIONS.length).toBeGreaterThanOrEqual(4);
    for (const qa of QUICK_ACTIONS) {
      expect(qa.id).toBeTruthy();
      expect(qa.label).toBeTruthy();
      expect(qa.icon).toBeTruthy();
      expect(qa.action).toBeTruthy();
    }
  });
});
