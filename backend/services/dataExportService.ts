import { Writable } from 'stream';

import archiver from 'archiver';
import PDFDocument from 'pdfkit';

import { store } from '../server/store';

export interface UserDataExport {
  user: unknown;
  pets: unknown[];
  medicalRecords: unknown[];
  appointments: unknown[];
  medications: unknown[];
  payments: unknown[];
  familySharing: unknown[];
  exportedAt: string;
}

export interface DataExportRequest {
  id: string;
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requestedAt: string;
  completedAt?: string;
  downloadUrl?: string;
  expiresAt?: string;
  error?: string;
}

// In-memory export request queue (replace with database in production)
const exportRequests = new Map<string, DataExportRequest>();

export function exportUserData(userId: string): UserDataExport {
  const user = store.users.get(userId);
  const pets = [...store.pets.values()].filter((p) => p.ownerId === userId);
  const petIds = new Set(pets.map((p) => p.id));

  const medicalRecords = [...store.medicalRecords.values()].filter((r) => petIds.has(r.petId));
  const appointments = [...store.appointments.values()].filter((a) => petIds.has(a.petId));
  const medications = [...store.medications.values()].filter((m) => petIds.has(m.petId));
  const payments = [...store.payments.values()].filter((p) => p.userId === userId);
  const familySharing = [...store.familySharing.values()].filter(
    (f) => f.ownerId === userId || f.sharedWithUserId === userId,
  );

  // Strip sensitive fields from user
  const { passwordHash: _pw, ...safeUser } = (user ?? {}) as Record<string, unknown>;

  return {
    user: safeUser,
    pets,
    medicalRecords,
    appointments,
    medications,
    payments,
    familySharing,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Queue a data export request for async processing
 */
export function requestDataExport(userId: string, userEmail: string): DataExportRequest {
  const requestId = `export_${Date.now()}_${userId}`;
  const request: DataExportRequest = {
    id: requestId,
    userId,
    status: 'pending',
    requestedAt: new Date().toISOString(),
  };

  exportRequests.set(requestId, request);

  // Process async (in production, use a job queue like Bull or AWS SQS)
  void processDataExport(requestId, userEmail);

  return request;
}

/**
 * Get export request status
 */
export function getExportRequest(requestId: string): DataExportRequest | undefined {
  return exportRequests.get(requestId);
}

/**
 * Get all export requests for a user
 */
export function getUserExportRequests(userId: string): DataExportRequest[] {
  return [...exportRequests.values()]
    .filter((r) => r.userId === userId)
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

/**
 * Process data export: generate ZIP with JSON + PDF
 */
async function processDataExport(requestId: string, userEmail: string): Promise<void> {
  const request = exportRequests.get(requestId);
  if (!request) return;

  try {
    request.status = 'processing';
    exportRequests.set(requestId, request);

    const data = exportUserData(request.userId);

    // Generate PDF summary for each pet
    const pdfBuffers: Record<string, Buffer> = {};
    for (const pet of data.pets as Array<{ id: string; name: string }>) {
      pdfBuffers[pet.id] = await generatePetPDF(pet, data);
    }

    // Create ZIP archive (in production, upload to S3 or similar)
    const zipBuffer = await createZipArchive(data, pdfBuffers);

    // In production: upload to S3 and get signed URL
    const downloadUrl = `/api/privacy/export/${requestId}/download`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 hours

    request.status = 'completed';
    request.completedAt = new Date().toISOString();
    request.downloadUrl = downloadUrl;
    request.expiresAt = expiresAt;
    exportRequests.set(requestId, request);

    // Send email notification (in production, use SendGrid, SES, etc.)
    await sendExportEmail(userEmail, downloadUrl, expiresAt);
  } catch (error) {
    request.status = 'failed';
    request.error = error instanceof Error ? error.message : 'Unknown error';
    exportRequests.set(requestId, request);
  }
}

/**
 * Generate PDF summary for a pet
 */
async function generatePetPDF(
  pet: { id: string; name: string },
  data: UserDataExport,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument();

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text(`${pet.name} - Health Summary`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Export Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    const petRecords = (
      data.medicalRecords as Array<{ petId: string; type: string; notes?: string }>
    ).filter((r) => r.petId === pet.id);
    doc.fontSize(14).text('Medical Records', { underline: true });
    doc.fontSize(10);
    petRecords.forEach((r) => {
      doc.text(`- ${r.type}: ${r.notes || 'No notes'}`);
    });

    doc.end();
  });
}

/**
 * Create ZIP archive with JSON data and PDF summaries
 */
async function createZipArchive(
  data: UserDataExport,
  pdfBuffers: Record<string, Buffer>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Add JSON data
    archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });

    // Add PDF summaries
    Object.entries(pdfBuffers).forEach(([petId, buffer]) => {
      const petName =
        (data.pets as Array<{ id: string; name: string }>).find((p) => p.id === petId)?.name ||
        petId;
      archive.append(buffer, { name: `${petName}_summary.pdf` });
    });

    archive.finalize();
  });
}

/**
 * Send email notification with download link
 */
async function sendExportEmail(
  email: string,
  downloadUrl: string,
  expiresAt: string,
): Promise<void> {
  // In production: use SendGrid, AWS SES, or similar
  console.log(`[GDPR Export] Email sent to ${email}`);
  console.log(`Download URL: ${downloadUrl}`);
  console.log(`Expires: ${expiresAt}`);
  // Mock implementation - replace with actual email service
}

export function eraseUserData(userId: string): void {
  // Hard-delete all PII
  store.users.delete(userId);

  const petIds: string[] = [];
  store.pets.forEach((p, id) => {
    if (p.ownerId === userId) petIds.push(id);
  });
  petIds.forEach((id) => store.pets.delete(id));

  store.medicalRecords.forEach((r, id) => {
    if (petIds.includes(r.petId)) store.medicalRecords.delete(id);
  });
  store.appointments.forEach((a, id) => {
    if (petIds.includes(a.petId)) store.appointments.delete(id);
  });
  store.medications.forEach((m, id) => {
    if (petIds.includes(m.petId)) store.medications.delete(id);
  });
}

// In-memory consent log (replace with DB in production)
interface ConsentEntry {
  userId: string;
  category: string;
  granted: boolean;
  createdAt: string;
}
const consentLog: ConsentEntry[] = [];

export function logConsent(userId: string, category: string, granted: boolean): void {
  consentLog.push({ userId, category, granted, createdAt: new Date().toISOString() });
}

export function getConsentHistory(userId: string): ConsentEntry[] {
  return consentLog.filter((e) => e.userId === userId);
}
