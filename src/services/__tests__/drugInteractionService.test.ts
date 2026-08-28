import * as SecureStore from 'expo-secure-store';

import {
  checkDrugInteractions,
  findInteraction,
  getSeverityLabel,
  isInteractionOverridden,
  recordVetOverride,
} from '../../services/drugInteractionService';

// expo-secure-store is auto-mocked via jest.config.js moduleNameMapper

const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

describe('drugInteractionService — Issue #335', () => {
  describe('checkDrugInteractions', () => {
    it('detects severe NSAID + corticosteroid interaction', async () => {
      const result = await checkDrugInteractions('carprofen', ['prednisone']);
      expect(result.hasInteractions).toBe(true);
      expect(result.interactions[0].severity).toBe('severe');
      expect(result.interactions[0].drugA).toBe('carprofen');
    });

    it('detects interaction regardless of argument order', async () => {
      const result = await checkDrugInteractions('prednisone', ['carprofen']);
      expect(result.hasInteractions).toBe(true);
    });

    it('detects moderate interaction (phenobarbital + metronidazole)', async () => {
      const result = await checkDrugInteractions('phenobarbital', ['metronidazole']);
      expect(result.hasInteractions).toBe(true);
      expect(result.interactions[0].severity).toBe('moderate');
    });

    it('detects mild interaction (enrofloxacin + doxycycline)', async () => {
      const result = await checkDrugInteractions('enrofloxacin', ['doxycycline']);
      expect(result.hasInteractions).toBe(true);
      expect(result.interactions[0].severity).toBe('mild');
    });

    it('detects contraindicated interaction (carprofen + enrofloxacin)', async () => {
      const result = await checkDrugInteractions('carprofen', ['enrofloxacin']);
      expect(result.hasInteractions).toBe(true);
      expect(result.interactions[0].severity).toBe('contraindicated');
    });

    it('detects contraindicated regardless of argument order', async () => {
      const result = await checkDrugInteractions('enrofloxacin', ['carprofen']);
      expect(result.hasInteractions).toBe(true);
      expect(result.interactions[0].severity).toBe('contraindicated');
    });

    it('returns no interactions for non-interacting drugs', async () => {
      const result = await checkDrugInteractions('amoxicillin', ['phenobarbital']);
      expect(result.hasInteractions).toBe(false);
      expect(result.interactions).toHaveLength(0);
    });

    it('returns no interactions for empty existing drugs list', async () => {
      const result = await checkDrugInteractions('carprofen', []);
      expect(result.hasInteractions).toBe(false);
    });

    it('checks multiple existing drugs and finds all interactions', async () => {
      const result = await checkDrugInteractions('carprofen', ['prednisone', 'meloxicam']);
      expect(result.interactions.length).toBeGreaterThanOrEqual(2);
    });

    it('uses cached interactions when available', async () => {
      const cached = [
        {
          drugA: 'testdrugA',
          drugB: 'testdrugB',
          severity: 'mild',
          description: 'test',
          recommendation: 'test',
        },
      ];
      mockGetItem.mockResolvedValueOnce(
        JSON.stringify({ data: cached, expiresAt: Date.now() + 10000 }),
      );
      const result = await checkDrugInteractions('testdrugA', ['testdrugB']);
      expect(result.hasInteractions).toBe(true);
    });
  });

  describe('findInteraction', () => {
    it('finds known interaction', () => {
      const hit = findInteraction('carprofen', 'prednisone');
      expect(hit).toBeDefined();
      expect(hit?.severity).toBe('severe');
    });

    it('returns undefined for unknown pair', () => {
      expect(findInteraction('amoxicillin', 'phenobarbital')).toBeUndefined();
    });
  });

  describe('getSeverityLabel', () => {
    it('returns correct labels', () => {
      expect(getSeverityLabel('mild')).toContain('Mild');
      expect(getSeverityLabel('moderate')).toContain('Moderate');
      expect(getSeverityLabel('severe')).toContain('Severe');
      expect(getSeverityLabel('contraindicated')).toContain('Contraindicated');
    });
  });

  describe('recordVetOverride / isInteractionOverridden', () => {
    it('stores and retrieves a vet override', async () => {
      mockGetItem.mockResolvedValue(null);
      mockSetItem.mockResolvedValue(undefined);

      await recordVetOverride({
        drugA: 'carprofen',
        drugB: 'prednisone',
        vetId: 'vet-001',
        justification: 'Post-surgical pain management required',
      });

      expect(mockSetItem).toHaveBeenCalled();
      const stored = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(stored[0].vetId).toBe('vet-001');
      expect(stored[0].timestamp).toBeDefined();
    });

    it('returns null when no override exists', async () => {
      mockGetItem.mockResolvedValue(null);
      const result = await isInteractionOverridden('carprofen', 'prednisone');
      expect(result).toBeNull();
    });

    it('finds override regardless of drug order', async () => {
      const overrides = [
        {
          drugA: 'carprofen',
          drugB: 'prednisone',
          vetId: 'vet-001',
          justification: 'test',
          timestamp: new Date().toISOString(),
        },
      ];
      mockGetItem.mockResolvedValue(JSON.stringify(overrides));
      const result = await isInteractionOverridden('prednisone', 'carprofen');
      expect(result).not.toBeNull();
      expect(result?.vetId).toBe('vet-001');
    });
  });
});
