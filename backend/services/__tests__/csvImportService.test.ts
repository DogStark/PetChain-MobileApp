import { validateRow, importCsvRecords } from '../csvImportService';

describe('csvImportService', () => {
  describe('validateRow', () => {
    it('returns errors for missing required fields', () => {
      const row = { petId: '', vetId: '', type: '', visitDate: '' } as any;
      const errs = validateRow(row, 1);
      expect(errs.length).toBeGreaterThanOrEqual(3);
      expect(errs.find((e) => e.field === 'petId')).toBeTruthy();
      expect(errs.find((e) => e.field === 'vetId')).toBeTruthy();
      expect(errs.find((e) => e.field === 'type')).toBeTruthy();
    });
  });

  describe('importCsvRecords', () => {
    it('imports valid rows and skips invalid ones', async () => {
      const csv = `petId,vetId,type,visitDate,diagnosis
p-demo-1,v-demo-1,vaccination,2026-06-01,Checkup
,v-demo-1,checkup,2026-06-02,MissingPetId
p-demo-1,v-demo-1,invalidtype,2026-06-03,BadType`;

      const res = await importCsvRecords(csv);

      expect(res.imported).toBe(1);
      expect(res.skipped).toBe(2);
      expect(res.errors.length).toBeGreaterThanOrEqual(2);
      expect(res.records.length).toBe(1);
      expect(res.txHashes.length).toBe(1);
    });

    it('returns header error when missing required columns', async () => {
      const csv = `petId,vetId,diagnosis
p-demo-1,v-demo-1,Checkup`;
      const res = await importCsvRecords(csv);
      expect(res.imported).toBe(0);
      expect(res.errors.length).toBe(1);
      expect(res.errors[0].message).toMatch(/Missing required column/);
    });
  });
});
