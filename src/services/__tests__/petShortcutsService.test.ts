import type { Pet } from '../petService';
import {
  buildPetAppShortcuts,
  MAX_PET_SHORTCUTS,
  PET_SHORTCUT_ACTION_TYPE,
  recordRecentPetSelection,
  resolvePetShortcutLaunch,
  sanitizeShortcutLabel,
  type RecentPetEntry,
} from '../petShortcutsService';

const makePet = (overrides: Partial<Pet> = {}): Pet => ({
  id: 'pet-1',
  name: 'Buddy',
  species: 'dog',
  breed: 'Golden Retriever',
  dateOfBirth: '2022-05-01',
  weightKg: 28,
  ownerId: 'user-1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

describe('petShortcutsService (issue #1191)', () => {
  const now = 1_700_000_000_000;

  describe('sanitizeShortcutLabel (privacy by default)', () => {
    it('strips microchip numbers, Stellar addresses, UUIDs, emails, and key-value tokens', () => {
      const stellarKey = 'G' + 'B'.repeat(55);
      const raw = `Buddy (985112003456789) [${stellarKey}] chip=12345 owner@example.com 550e8400-e29b-41d4-a716-446655440000`;
      const cleaned = sanitizeShortcutLabel(raw);

      expect(cleaned).toBe('Buddy');
      expect(cleaned).not.toContain('985112003456789');
      expect(cleaned).not.toContain(stellarKey);
      expect(cleaned).not.toContain('owner@example.com');
      expect(cleaned).not.toContain('550e8400');
    });

    it('falls back to "Pet" when label is empty or only contains sensitive tokens', () => {
      expect(sanitizeShortcutLabel('')).toBe('Pet');
      expect(sanitizeShortcutLabel(null)).toBe('Pet');
      expect(sanitizeShortcutLabel('985112003456789')).toBe('Pet');
    });
  });

  describe('recordRecentPetSelection & buildPetAppShortcuts', () => {
    it('maintains MRU ordering, deduplicates entries, and caps at MAX_PET_SHORTCUTS', () => {
      let entries: RecentPetEntry[] = [];
      for (let i = 1; i <= 6; i++) {
        entries = recordRecentPetSelection(
          entries,
          makePet({ id: `pet-${i}`, name: `Pet ${i}` }),
          now + i * 1000,
        );
      }

      expect(entries).toHaveLength(MAX_PET_SHORTCUTS);
      expect(entries.map((e) => e.petId)).toEqual(['pet-6', 'pet-5', 'pet-4', 'pet-3']);

      // Re-selecting pet-4 moves it to the front without duplicating
      entries = recordRecentPetSelection(
        entries,
        makePet({ id: 'pet-4', name: 'Pet 4' }),
        now + 10_000,
      );
      expect(entries.map((e) => e.petId)).toEqual(['pet-4', 'pet-6', 'pet-5', 'pet-3']);
    });

    it('ignores unconfirmed optimistic placeholders', () => {
      const entries = recordRecentPetSelection(
        [],
        makePet({ id: 'optimistic-12345', name: 'Temp' }),
        now,
      );
      expect(entries).toHaveLength(0);
    });

    it('builds accessible, privacy-safe shortcut items filtered by available pets', () => {
      const pets = [
        makePet({ id: 'pet-1', name: 'Luna 985112003456789', species: 'cat' }),
        makePet({ id: 'pet-2', name: 'Max', species: 'dog' }),
      ];
      let entries = recordRecentPetSelection([], pets[0], now);
      entries = recordRecentPetSelection(entries, pets[1], now + 1000);
      entries = recordRecentPetSelection(
        entries,
        makePet({ id: 'deleted-pet', name: 'Ghost' }),
        now + 2000,
      );

      const shortcuts = buildPetAppShortcuts(entries, pets);
      expect(shortcuts).toHaveLength(2);
      expect(shortcuts[0]).toMatchObject({
        id: 'pet-shortcut-1',
        type: PET_SHORTCUT_ACTION_TYPE,
        title: 'Max',
        subtitle: 'Switch to dog profile',
        accessibilityLabel: 'Switch active pet to Max',
        userInfo: { petId: 'pet-2' },
      });
      expect(shortcuts[1].title).toBe('Luna');
      expect(shortcuts[1].title).not.toContain('985112003456789');
    });
  });

  describe('resolvePetShortcutLaunch (server-confirmed access, denial, stale data, offline)', () => {
    const buddy = makePet({ id: 'pet-1', name: 'Buddy', ownerId: 'user-1' });
    const milo = makePet({ id: 'pet-2', name: 'Milo (985112003456789)', ownerId: 'user-1' });
    const pets = [buddy, milo];

    it('activates the requested pet when server-confirmed access is valid', () => {
      const recent = recordRecentPetSelection([], buddy, now - 5000);
      const result = resolvePetShortcutLaunch({
        shortcutPayload: { type: PET_SHORTCUT_ACTION_TYPE, userInfo: { petId: 'pet-2' } },
        pets,
        recentEntries: recent,
        fallbackActivePet: buddy,
        now,
        accessConfirmation: {
          petId: 'pet-2',
          currentUserId: 'user-1',
          serverConfirmed: true,
          hasAccess: true,
          confirmedAt: now - 10_000,
        },
      });

      expect(result.allowed).toBe(true);
      expect(result.status).toBe('activated');
      expect(result.activePet?.id).toBe('pet-2');
      expect(result.announcement).toBe('Active pet switched to Milo.');
      expect(result.updatedRecentEntries[0].petId).toBe('pet-2');
    });

    it('preserves offline behavior when offline with cached access for the signed-in owner', () => {
      const recent = recordRecentPetSelection([], milo, now - 5000);
      const result = resolvePetShortcutLaunch({
        shortcutPayload: { type: PET_SHORTCUT_ACTION_TYPE, userInfo: { petId: 'pet-2' } },
        pets,
        recentEntries: recent,
        fallbackActivePet: buddy,
        now,
        accessConfirmation: {
          petId: 'pet-2',
          currentUserId: 'user-1',
          serverConfirmed: false,
          hasAccess: false,
          confirmedAt: null,
          isOffline: true,
          offlineCachedAccess: true,
        },
      });

      expect(result.allowed).toBe(true);
      expect(result.status).toBe('activated_offline');
      expect(result.activePet?.id).toBe('pet-2');
      expect(result.announcement).toContain('Offline mode');
    });

    it('denies activation and evicts shortcut when access is revoked or belongs to another user', () => {
      let recent = recordRecentPetSelection([], buddy, now - 5000);
      recent = recordRecentPetSelection(recent, milo, now - 1000);

      const deniedResult = resolvePetShortcutLaunch({
        shortcutPayload: { type: PET_SHORTCUT_ACTION_TYPE, userInfo: { petId: 'pet-2' } },
        pets,
        recentEntries: recent,
        fallbackActivePet: buddy,
        now,
        accessConfirmation: {
          petId: 'pet-2',
          currentUserId: 'other-user-99',
          serverConfirmed: true,
          hasAccess: true,
          confirmedAt: now - 1000,
        },
      });

      expect(deniedResult.allowed).toBe(false);
      expect(deniedResult.status).toBe('access_denied');
      expect(deniedResult.activePet?.id).toBe('pet-1');
      expect(deniedResult.updatedRecentEntries.map((e) => e.petId)).toEqual(['pet-1']);
    });

    it('returns retryable stale_access when server confirmation timestamp has expired', () => {
      const recent = recordRecentPetSelection([], milo, now - 5000);
      const staleResult = resolvePetShortcutLaunch({
        shortcutPayload: { type: PET_SHORTCUT_ACTION_TYPE, userInfo: { petId: 'pet-2' } },
        pets,
        recentEntries: recent,
        fallbackActivePet: buddy,
        now,
        accessConfirmation: {
          petId: 'pet-2',
          currentUserId: 'user-1',
          serverConfirmed: true,
          hasAccess: true,
          confirmedAt: now - 10 * 60 * 1000,
          staleAfterMs: 5 * 60 * 1000,
        },
      });

      expect(staleResult.allowed).toBe(false);
      expect(staleResult.status).toBe('stale_access');
      expect(staleResult.retryable).toBe(true);
      expect(staleResult.activePet?.id).toBe('pet-1');
      // Does not evict on transient staleness so retry succeeds
      expect(staleResult.updatedRecentEntries).toHaveLength(1);
    });

    it('handles missing pet or invalid shortcut payload gracefully', () => {
      const recent = recordRecentPetSelection([], milo, now - 5000);
      const missingPet = resolvePetShortcutLaunch({
        shortcutPayload: { type: PET_SHORTCUT_ACTION_TYPE, userInfo: { petId: 'pet-999' } },
        pets,
        recentEntries: recent,
        fallbackActivePet: buddy,
        now,
      });
      expect(missingPet.allowed).toBe(false);
      expect(missingPet.status).toBe('pet_not_found');

      const badPayload = resolvePetShortcutLaunch({
        shortcutPayload: { type: 'unknown.action', userInfo: { petId: 'pet-1' } },
        pets,
        recentEntries: recent,
        fallbackActivePet: buddy,
        now,
      });
      expect(badPayload.allowed).toBe(false);
      expect(badPayload.status).toBe('invalid_payload');
    });
  });
});
