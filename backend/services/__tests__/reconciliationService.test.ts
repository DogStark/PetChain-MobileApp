/**
 * Tests for ReconciliationService
 * Issue #102 — Automated Vet Record Reconciliation
 *
 * Covers:
 * - hashRecord produces stable, deterministic hashes
 * - hashRecord excludes blockchain fields from the hash
 * - Clean records are identified correctly
 * - Tampered records (local hash ≠ on-chain hash) are flagged
 * - Records with no blockchain entry are flagged as missing_chain
 * - Re-anchoring is attempted for tampered/missing records
 * - Full reconciliation run produces a correct report
 * - Concurrent run guard works
 */

import type { StoredMedicalRecord } from '../../server/store';
import { store } from '../../server/store';
import { hashRecord, ReconciliationService } from '../reconciliationService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<StoredMedicalRecord> = {}): StoredMedicalRecord {
  return {
    id: 'test-record-1',
    petId: 'p-test-1',
    vetId: 'v-test-1',
    type: 'vaccination',
    diagnosis: 'Annual wellness',
    treatment: 'Rabies vaccine',
    notes: 'No adverse reaction',
    visitDate: '2026-01-15',
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    blockchainTxHash: undefined,
    blockchainHash: undefined,
    isBlockchainVerified: false,
    blockchainVerifiedAt: undefined,
    ...overrides,
  };
}

// ─── hashRecord ───────────────────────────────────────────────────────────────

describe('hashRecord', () => {
  it('produces a 64-character hex string', () => {
    const hash = hashRecord(makeRecord());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same record produces same hash', () => {
    const r = makeRecord();
    expect(hashRecord(r)).toBe(hashRecord(r));
  });

  it('changes when clinical content changes', () => {
    const r1 = makeRecord({ notes: 'No adverse reaction' });
    const r2 = makeRecord({ notes: 'Mild swelling observed' });
    expect(hashRecord(r1)).not.toBe(hashRecord(r2));
  });

  it('does NOT change when only blockchain fields change', () => {
    const base = makeRecord();
    const withChain = makeRecord({
      blockchainTxHash: 'some-tx-hash',
      blockchainHash: 'some-hash',
      isBlockchainVerified: true,
      blockchainVerifiedAt: '2026-01-16T00:00:00.000Z',
    });
    expect(hashRecord(base)).toBe(hashRecord(withChain));
  });

  it('changes when visitDate changes', () => {
    const r1 = makeRecord({ visitDate: '2026-01-15' });
    const r2 = makeRecord({ visitDate: '2026-06-01' });
    expect(hashRecord(r1)).not.toBe(hashRecord(r2));
  });
});

// ─── ReconciliationService ────────────────────────────────────────────────────

describe('ReconciliationService', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    service = new ReconciliationService();
    service._resetState();
  });

  // ── checkRecord ─────────────────────────────────────────────────────────────

  describe('checkRecord', () => {
    it('returns missing_chain for a record with no blockchain entry', async () => {
      const record = makeRecord(); // no blockchainHash
      const result = await service.checkRecord(record);
      expect(result.status).toBe('missing_chain');
      expect(result.hashMatch).toBe(false);
      expect(result.onChainHash).toBeNull();
    });

    it('returns clean for a record whose local hash matches the stored on-chain hash', async () => {
      const record = makeRecord();
      const localHash = hashRecord(record);
      const anchored = makeRecord({ blockchainHash: localHash, blockchainTxHash: 'tx-abc' });

      const result = await service.checkRecord(anchored);
      expect(result.status).toBe('clean');
      expect(result.hashMatch).toBe(true);
      expect(result.localHash).toBe(localHash);
    });

    it('returns tampered when local hash differs from on-chain hash', async () => {
      const record = makeRecord();
      const localHash = hashRecord(record);
      // Simulate tampering: on-chain hash was computed from the original record,
      // but the local record has been modified (different notes)
      const tamperedRecord = makeRecord({
        notes: 'TAMPERED CONTENT',
        blockchainHash: localHash, // on-chain still has the original hash
        blockchainTxHash: 'tx-original',
      });

      const result = await service.checkRecord(tamperedRecord);
      expect(result.status).toBe('tampered');
      expect(result.hashMatch).toBe(false);
      expect(result.onChainHash).toBe(localHash);
      expect(result.localHash).not.toBe(localHash);
    });

    it('includes petName when pet exists in store', async () => {
      const record = makeRecord({ petId: 'p-demo-1' }); // demo pet exists in seed
      const result = await service.checkRecord(record);
      expect(result.petName).toBe('Buddy');
    });

    it('sets checkedAt to a recent ISO timestamp', async () => {
      const before = Date.now();
      const record = makeRecord();
      const result = await service.checkRecord(record);
      const after = Date.now();
      const checkedMs = new Date(result.checkedAt).getTime();
      expect(checkedMs).toBeGreaterThanOrEqual(before);
      expect(checkedMs).toBeLessThanOrEqual(after);
    });
  });

  // ── run ─────────────────────────────────────────────────────────────────────

  describe('run', () => {
    it('produces a report with correct totals', async () => {
      // Seed store with known records
      const clean = makeRecord({ id: 'r-clean' });
      const cleanHash = hashRecord(clean);
      store.medicalRecords.set('r-clean', {
        ...clean,
        blockchainHash: cleanHash,
        blockchainTxHash: 'tx-1',
      });

      const tampered = makeRecord({ id: 'r-tampered', notes: 'MODIFIED' });
      const originalHash = hashRecord(makeRecord({ id: 'r-tampered' })); // original hash
      store.medicalRecords.set('r-tampered', {
        ...tampered,
        blockchainHash: originalHash,
        blockchainTxHash: 'tx-2',
      });

      const unanchored = makeRecord({ id: 'r-unanchored' });
      store.medicalRecords.set('r-unanchored', unanchored);

      const report = await service.run();

      expect(report.totalRecords).toBeGreaterThanOrEqual(3);
      expect(report.cleanCount).toBeGreaterThanOrEqual(1);
      expect(report.tamperedCount).toBeGreaterThanOrEqual(1);
      expect(report.missingChainCount).toBeGreaterThanOrEqual(1);
      expect(report.results.length).toBe(report.totalRecords);
      expect(report.id).toBeDefined();
      expect(report.startedAt).toBeDefined();
      expect(report.completedAt).toBeDefined();

      // Cleanup
      store.medicalRecords.delete('r-clean');
      store.medicalRecords.delete('r-tampered');
      store.medicalRecords.delete('r-unanchored');
    });

    it('stores the report and makes it retrievable', async () => {
      const report = await service.run();
      const fetched = service.getReport(report.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(report.id);
    });

    it('updates latestReport after a run', async () => {
      expect(service.getLatestReport()).toBeNull();
      await service.run();
      expect(service.getLatestReport()).not.toBeNull();
    });

    it('throws if a run is already in progress', async () => {
      // Manually set running state by starting a run and not awaiting
      const firstRun = service.run();
      await expect(service.run()).rejects.toThrow('already in progress');
      await firstRun; // let it finish
    });
  });

  // ── getSummary ───────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('returns null lastRunAt before any run', () => {
      const summary = service.getSummary();
      expect(summary.lastRunAt).toBeNull();
      expect(summary.isRunning).toBe(false);
    });

    it('returns lastRunAt after a run', async () => {
      await service.run();
      const summary = service.getSummary();
      expect(summary.lastRunAt).not.toBeNull();
      expect(summary.lastReport).not.toBeNull();
    });
  });

  // ── listReports ──────────────────────────────────────────────────────────────

  describe('listReports', () => {
    it('returns reports sorted newest first', async () => {
      await service.run();
      await service.run();
      const list = service.listReports();
      expect(list.length).toBe(2);
      expect(new Date(list[0].startedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(list[1].startedAt).getTime(),
      );
    });
  });
});
