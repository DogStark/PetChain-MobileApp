import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import type { StoredMedicalRecord, StoredMedication, StoredPet, StoredUser } from '../server/store';

export interface ReportOptions {
  pet: StoredPet;
  owner: StoredUser;
  records: StoredMedicalRecord[];
  medications: StoredMedication[];
  generatedBy: string; // authenticated user id
  dateFrom?: string; // ISO date string, inclusive
  dateTo?: string; // ISO date string, inclusive
  blockchainBaseUrl?: string;
}

export interface ReportResult {
  buffer: Buffer;
  filename: string;
  recordCount: number;
}

// ── Sanitize user content to prevent injection ─────────────────────────────
function sanitize(value: unknown): string {
  if (value == null) return '';
  return (
    String(value)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
      .slice(0, 2000)
  ); // cap length
}

// ── Filter records by optional date range ──────────────────────────────────
export function filterByDateRange(
  records: StoredMedicalRecord[],
  dateFrom?: string,
  dateTo?: string,
): StoredMedicalRecord[] {
  return records.filter((r) => {
    if (dateFrom && r.visitDate < dateFrom) return false;
    if (dateTo && r.visitDate > dateTo) return false;
    return true;
  });
}

// ── Generate QR code as PNG Buffer ─────────────────────────────────────────
export async function generateQRCodeBuffer(url: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(url, { width: 120, margin: 1, errorCorrectionLevel: 'M' });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

// ── Draw watermark on current page ─────────────────────────────────────────
let _drawingWatermark = false;
function drawWatermark(doc: PDFKit.PDFDocument, generatedBy: string, timestamp: string): void {
  if (_drawingWatermark) return; // prevent re-entrant calls from pageAdded
  _drawingWatermark = true;
  try {
    const { width, height } = doc.page;
    doc.save();
    doc
      .fontSize(8)
      .fillColor('#cccccc')
      .opacity(0.5)
      .text(`Generated: ${timestamp} | User: ${generatedBy}`, 0, height - 20, {
        width,
        align: 'center',
        lineBreak: false,
      });
    doc.restore();
  } finally {
    _drawingWatermark = false;
  }
}

// ── Section header helper ──────────────────────────────────────────────────
function sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc
    .moveDown(0.5)
    .fontSize(12)
    .fillColor('#1a56db')
    .text(title)
    .moveDown(0.2)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#1a56db')
    .lineWidth(0.5)
    .stroke()
    .moveDown(0.3)
    .fillColor('#111111')
    .fontSize(10);
}

// ── Row helper ─────────────────────────────────────────────────────────────
function row(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc
    .fontSize(9)
    .fillColor('#555555')
    .text(`${label}: `, { continued: true })
    .fillColor('#111111')
    .text(value || '—');
}

// ── Main PDF generation ────────────────────────────────────────────────────
export async function generateHealthReport(opts: ReportOptions): Promise<ReportResult> {
  const {
    pet,
    owner,
    records,
    medications,
    generatedBy,
    dateFrom,
    dateTo,
    blockchainBaseUrl = 'https://petchain.app/verify',
  } = opts;

  const filteredRecords = filterByDateRange(records, dateFrom, dateTo);
  const timestamp = new Date().toISOString();
  const filename = `health-report-${sanitize(pet.id)}-${Date.now()}.pdf`;

  // Collect blockchain tx hashes for QR
  const verifiedRecords = filteredRecords.filter((r) => r.blockchainTxHash);
  const qrUrl =
    verifiedRecords.length > 0
      ? `${blockchainBaseUrl}/${sanitize(pet.id)}`
      : `${blockchainBaseUrl}/${sanitize(pet.id)}`;

  const qrBuffer = await generateQRCodeBuffer(qrUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', autoFirstPage: true });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () =>
      resolve({ buffer: Buffer.concat(chunks), filename, recordCount: filteredRecords.length }),
    );

    // Track pages for watermark
    const addWatermark = () => drawWatermark(doc, generatedBy, timestamp);
    doc.on('pageAdded', addWatermark);

    // ── Cover / Header ──────────────────────────────────────────────────
    doc
      .fontSize(20)
      .fillColor('#1a56db')
      .text('PetChain Health Report', { align: 'center' })
      .moveDown(0.3)
      .fontSize(10)
      .fillColor('#555555')
      .text(`Generated: ${new Date(timestamp).toLocaleString()}`, { align: 'center' })
      .moveDown(0.1)
      .text(`Report Period: ${dateFrom ?? 'All time'} → ${dateTo ?? 'Present'}`, {
        align: 'center',
      })
      .moveDown(0.5);

    // QR code (top-right)
    const qrX = doc.page.width - doc.page.margins.right - 120;
    doc.image(qrBuffer, qrX, 50, { width: 100 });
    doc
      .fontSize(7)
      .fillColor('#888888')
      .text('Scan to verify on blockchain', qrX, 155, { width: 100, align: 'center' });

    // ── Pet Profile ─────────────────────────────────────────────────────
    sectionHeader(doc, 'Pet Profile');
    row(doc, 'Name', sanitize(pet.name));
    row(doc, 'Species', sanitize(pet.species));
    row(doc, 'Breed', sanitize(pet.breed));
    row(doc, 'Date of Birth', sanitize(pet.dateOfBirth));
    row(doc, 'Microchip ID', sanitize(pet.microchipId));

    // ── Owner Info ──────────────────────────────────────────────────────
    sectionHeader(doc, 'Owner Information');
    row(doc, 'Name', sanitize(owner.name));
    row(doc, 'Email', sanitize(owner.email));
    row(doc, 'Phone', sanitize(owner.phone));

    // ── Medical History ─────────────────────────────────────────────────
    sectionHeader(
      doc,
      `Medical History (${filteredRecords.length} record${filteredRecords.length !== 1 ? 's' : ''})`,
    );

    if (filteredRecords.length === 0) {
      doc
        .fontSize(9)
        .fillColor('#888888')
        .text('No medical records found for the selected period.');
    } else {
      filteredRecords.forEach((record, idx) => {
        // Page break if near bottom
        if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
          doc.addPage();
        }

        doc
          .fontSize(10)
          .fillColor('#333333')
          .text(
            `${idx + 1}. ${sanitize(record.type).toUpperCase()} — ${sanitize(record.visitDate)}`,
            {
              underline: true,
            },
          )
          .moveDown(0.1);

        row(doc, 'Diagnosis', sanitize(record.diagnosis));
        row(doc, 'Treatment', sanitize(record.treatment));
        row(doc, 'Notes', sanitize(record.notes));
        row(doc, 'Next Visit', sanitize(record.nextVisitDate));

        if (record.blockchainTxHash) {
          doc
            .fontSize(8)
            .fillColor('#1a56db')
            .text(`✓ Blockchain verified: ${sanitize(record.blockchainTxHash).slice(0, 20)}…`);
        }
        doc.moveDown(0.4);
      });
    }

    // ── Current Medications ─────────────────────────────────────────────
    const activeMeds = medications.filter((m) => m.active);
    sectionHeader(doc, `Current Medications (${activeMeds.length})`);

    if (activeMeds.length === 0) {
      doc.fontSize(9).fillColor('#888888').text('No active medications.');
    } else {
      activeMeds.forEach((med) => {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
        doc
          .fontSize(10)
          .fillColor('#333333')
          .text(`• ${sanitize(med.name)}`)
          .moveDown(0.1);
        row(doc, 'Dosage', sanitize(med.dosage));
        row(doc, 'Frequency', sanitize(med.frequency));
        row(doc, 'Start Date', sanitize(med.startDate));
        doc.moveDown(0.3);
      });
    }

    // ── Blockchain Verification Summary ────────────────────────────────
    sectionHeader(doc, 'Blockchain Verification');
    row(doc, 'Verified Records', String(verifiedRecords.length));
    row(doc, 'Verification URL', qrUrl);
    doc
      .moveDown(0.3)
      .fontSize(8)
      .fillColor('#888888')
      .text('Scan the QR code on the first page to verify this report on the Stellar blockchain.');

    // Watermark on first page (pageAdded fires for subsequent pages only)
    addWatermark();

    doc.end();
  });
}
