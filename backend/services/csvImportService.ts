/**
 * CSV Import Service for bulk medical record import.
 *
 * Schema (header row required):
 *   petId, vetId, type, visitDate, diagnosis, treatment, notes, nextVisitDate
 *
 * Required: petId, vetId, type, visitDate
 * type must be one of: checkup | vaccination | surgery | treatment | other
 * visitDate / nextVisitDate must be ISO 8601 date (YYYY-MM-DD)
 */
import CryptoJS from 'crypto-js';

import { store, type StoredMedicalRecord } from '../server/store';

export const VALID_TYPES = ['checkup', 'vaccination', 'surgery', 'treatment', 'other'] as const;
export type RecordType = (typeof VALID_TYPES)[number];

export interface CsvRow {
  petId: string;
  vetId: string;
  type: string;
  visitDate: string;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  nextVisitDate?: string;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: RowError[];
  records: StoredMedicalRecord[];
  txHashes: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── CSV parser (no external dependency) ──────────────────────────────────────

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    rows.push(fields);
  }
  return rows;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRow(row: CsvRow, rowIndex: number): RowError[] {
  const errors: RowError[] = [];

  if (!row.petId?.trim())
    errors.push({ row: rowIndex, field: 'petId', message: 'petId is required' });
  if (!row.vetId?.trim())
    errors.push({ row: rowIndex, field: 'vetId', message: 'vetId is required' });

  if (!row.type?.trim()) {
    errors.push({ row: rowIndex, field: 'type', message: 'type is required' });
  } else if (!VALID_TYPES.includes(row.type.trim().toLowerCase() as RecordType)) {
    errors.push({
      row: rowIndex,
      field: 'type',
      message: `type must be one of: ${VALID_TYPES.join(', ')}`,
    });
  }

  if (!row.visitDate?.trim()) {
    errors.push({ row: rowIndex, field: 'visitDate', message: 'visitDate is required' });
  } else if (!ISO_DATE.test(row.visitDate.trim())) {
    errors.push({ row: rowIndex, field: 'visitDate', message: 'visitDate must be YYYY-MM-DD' });
  }

  if (row.nextVisitDate?.trim() && !ISO_DATE.test(row.nextVisitDate.trim())) {
    errors.push({
      row: rowIndex,
      field: 'nextVisitDate',
      message: 'nextVisitDate must be YYYY-MM-DD',
    });
  }

  return errors;
}

// ── Blockchain anchor (stub — calls real service in production) ───────────────

function computeHash(record: StoredMedicalRecord): string {
  return CryptoJS.SHA256(
    JSON.stringify({ id: record.id, petId: record.petId, visitDate: record.visitDate }),
  ).toString();
}

async function anchorBatch(records: StoredMedicalRecord[]): Promise<string> {
  // Compute a deterministic batch hash from individual record hashes and return a mock tx hash.
  const combined = records.map((r) => computeHash(r)).join('|');
  const batchHash = CryptoJS.SHA256(combined).toString();
  // In production this would call a service that anchors the batch on Stellar
  return `batch-tx-${batchHash.slice(0, 16)}`;
}

// ── Main import function ──────────────────────────────────────────────────────

export async function importCsvRecords(csvText: string): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { imported: 0, skipped: 0, errors: [], records: [], txHashes: [] };
  }

  // First row is header
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const required = ['petid', 'vetid', 'type', 'visitdate'];
  for (const col of required) {
    if (!header.includes(col)) {
      return {
        imported: 0,
        skipped: rows.length - 1,
        errors: [{ row: 0, field: col, message: `Missing required column: ${col}` }],
        records: [],
        txHashes: [],
      };
    }
  }

  const idx = (name: string) => header.indexOf(name);

  const result: ImportResult = { imported: 0, skipped: 0, errors: [], records: [], txHashes: [] };

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const row: CsvRow = {
      petId: cols[idx('petid')] ?? '',
      vetId: cols[idx('vetid')] ?? '',
      type: cols[idx('type')] ?? '',
      visitDate: cols[idx('visitdate')] ?? '',
      diagnosis: cols[idx('diagnosis')] ?? undefined,
      treatment: cols[idx('treatment')] ?? undefined,
      notes: cols[idx('notes')] ?? undefined,
      nextVisitDate: cols[idx('nextvisitdate')] ?? undefined,
    };

    const errors = validateRow(row, i);
    if (errors.length > 0) {
      result.errors.push(...errors);
      result.skipped++;
      continue;
    }

    const t = new Date().toISOString();
    const id = store.newId();
    const record: StoredMedicalRecord = {
      id,
      petId: row.petId.trim(),
      vetId: row.vetId.trim(),
      type: row.type.trim().toLowerCase(),
      diagnosis: row.diagnosis?.trim() || undefined,
      treatment: row.treatment?.trim() || undefined,
      notes: row.notes?.trim() || undefined,
      visitDate: row.visitDate.trim(),
      nextVisitDate: row.nextVisitDate?.trim() || undefined,
      createdAt: t,
      updatedAt: t,
    };

    store.medicalRecords.set(id, record);
    result.records.push(record);
    result.imported++;
  }

  // Anchor all imported records in a single batch transaction (stubbed)
  if (result.records.length > 0) {
    const batchTx = await anchorBatch(result.records);
    result.txHashes.push(batchTx);
  }

  return result;
}
