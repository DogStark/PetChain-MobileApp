/**
 * Property-based tests for drugInteractionService.ts (Issue #599)
 *
 * Uses fast-check to verify properties that hold for arbitrary drug names,
 * catching edge cases that handpicked examples miss.
 */
import * as SecureStore from 'expo-secure-store';
import fc from 'fast-check';

import {
  checkDrugInteractions,
  findInteraction,
  getSeverityLabel,
} from '../../services/drugInteractionService';
import type { InteractionSeverity } from '../../services/drugInteractionService';

// expo-secure-store is auto-mocked via jest.config.js moduleNameMapper
const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Any reasonably short ASCII string — models arbitrary drug names. */
const drugNameArb = fc.string({ minLength: 1, maxLength: 30 });

/** A non-empty list of drug names (max 8 to keep tests fast). */
const drugListArb = fc.array(drugNameArb, { minLength: 1, maxLength: 8 });

/** All valid severity values. */
const severityArb: fc.Arbitrary<InteractionSeverity> =
  fc.constantFrom<InteractionSeverity>(
    'mild',
    'moderate',
    'severe',
    'contraindicated',
  );

// ─── Properties ─────────────────────────────────────────────────────────────

describe('drugInteractionService — property-based tests (fast-check)', () => {
  describe('findInteraction (sync)', () => {
    it('is symmetric: findInteraction(A, B) === findInteraction(B, A)', () => {
      fc.assert(
        fc.property(drugNameArb, drugNameArb, (a, b) => {
          const ab = findInteraction(a, b);
          const ba = findInteraction(b, a);

          // Both must be the same object reference (or both undefined)
          if (ab === undefined && ba === undefined) return true;
          if (ab === undefined || ba === undefined) return false;
          return (
            ab.severity === ba.severity &&
            ab.description === ba.description &&
            ab.recommendation === ba.recommendation
          );
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('getSeverityLabel (sync)', () => {
    it('every valid severity maps to a non-empty string containing the severity keyword', () => {
      fc.assert(
        fc.property(severityArb, (severity) => {
          const label = getSeverityLabel(severity);
          expect(label).toBeTruthy();
          expect(typeof label).toBe('string');
          // The label should contain at least the emoji + the severity keyword
          // e.g. "⚠️ Mild" contains "Mild"
          const severityCapitalized =
            severity.charAt(0).toUpperCase() + severity.slice(1);
          return label.includes(severityCapitalized);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('checkDrugInteractions (async)', () => {
    it('result.interactions is always an array', async () => {
      await fc.assert(
        fc.asyncProperty(drugNameArb, drugListArb, async (newDrug, existing) => {
          const result = await checkDrugInteractions(newDrug, existing);
          expect(Array.isArray(result.interactions)).toBe(true);
          expect(typeof result.hasInteractions).toBe('boolean');
          // Consistency invariant
          expect(result.hasInteractions).toBe(result.interactions.length > 0);
        }),
        { numRuns: 200 },
      );
    });

    it('interaction count never exceeds existingDrugs.length', async () => {
      await fc.assert(
        fc.asyncProperty(drugNameArb, drugListArb, async (newDrug, existing) => {
          const result = await checkDrugInteractions(newDrug, existing);
          expect(result.interactions.length).toBeLessThanOrEqual(
            existing.length,
          );
        }),
        { numRuns: 200 },
      );
    });

    it('removing a drug from existingDrugs never increases interaction count', async () => {
      await fc.assert(
        fc.asyncProperty(
          drugNameArb,
          fc.array(drugNameArb, { minLength: 2, maxLength: 6 }),
          fc.nat({ max: 4 }), // index to remove
          async (newDrug, existing, removalIdx) => {
            // Ensure we only remove within bounds
            const idx = removalIdx % existing.length;
            const fullResult = await checkDrugInteractions(newDrug, existing);
            const reducedExisting = [
              ...existing.slice(0, idx),
              ...existing.slice(idx + 1),
            ];
            const reducedResult = await checkDrugInteractions(
              newDrug,
              reducedExisting,
            );

            // Removing a drug should never add new interactions
            expect(reducedResult.interactions.length).toBeLessThanOrEqual(
              fullResult.interactions.length,
            );
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
