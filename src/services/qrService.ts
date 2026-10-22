import StellarSdk from '@stellar/stellar-sdk';
import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';

import * as medicationService from './medicationService';
import * as petService from './petService';
import { getQRImageUrl } from './qrCodeService';
import * as vaccinationService from './vaccinationService';
import { encodePayload } from '../utils/qrUtils';

const STELLAR_SECRET_KEY = 'stellar.secret';

export interface CheckinHealthSummary {
  weightKg?: number | null;
  medications: Array<{ id: string; name: string; dosage?: string; status?: string }>;
  allergies: string[];
  recentVaccinations: Array<{ id: string; vaccineName: string; administeredDate?: string }>;
}

export interface CheckinPayload {
  type: 'vet_checkin';
  version: number;
  petId: string;
  appointmentId: string;
  generatedAt: number;
  expiresAt: number;
  healthSummaryHash: string; // hex
  healthSummary: CheckinHealthSummary;
  signerPublicKey?: string;
  signature?: string; // base64
}

/** Default: 24 hours expiry */
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

async function getStoredStellarSecret(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(STELLAR_SECRET_KEY);
  } catch {
    return null;
  }
}

function computeHash(obj: unknown): string {
  const json = JSON.stringify(obj);
  return CryptoJS.SHA256(json).toString(CryptoJS.enc.Hex);
}

export const generateAppointmentCheckinQRCode = async (
  petId: string,
  appointmentId: string,
  opts?: { signerSecret?: string; expiryMs?: number; imageSize?: number },
): Promise<{ payload: string; imageUrl: string; raw: CheckinPayload }> => {
  const expiryMs = opts?.expiryMs ?? DEFAULT_EXPIRY_MS;

  const pet = await petService.getPetById(petId);

  const allMeds = await medicationService.getMedications();
  const meds = allMeds
    .filter((m) => m.petId === petId)
    .map((m) => ({ id: m.id, name: m.name, dosage: m.dosage, status: m.status }));

  let vaccinations: Array<{ id: string; vaccineName: string; administeredDate?: string }> = [];
  try {
    const v = await vaccinationService.getVaccinationReminders(petId);
    vaccinations = v.map((r) => ({
      id: r.id,
      vaccineName: r.vaccineName,
      administeredDate: r.lastAdministeredDate,
    }));
  } catch {
    vaccinations = [];
  }

  const healthSummary: CheckinHealthSummary = {
    weightKg: pet.weightKg ?? null,
    medications: meds,
    allergies: (pet as any).allergies ?? [],
    recentVaccinations: vaccinations,
  };

  const generatedAt = Date.now();
  const expiresAt = generatedAt + expiryMs;

  const healthSummaryHash = computeHash(healthSummary);

  const payload: CheckinPayload = {
    type: 'vet_checkin',
    version: 1,
    petId: petId,
    appointmentId: appointmentId,
    generatedAt,
    expiresAt,
    healthSummaryHash,
    healthSummary,
  };

  // Determine signer
  const secret = opts?.signerSecret ?? (await getStoredStellarSecret());
  if (secret) {
    try {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      const sig = keypair.sign(Buffer.from(healthSummaryHash, 'hex'));
      payload.signerPublicKey = keypair.publicKey();
      payload.signature = Buffer.from(sig).toString('base64');
    } catch (err) {
      // Do not fail QR generation if signing fails — return unsigned payload
      // but include an error log via console for visibility.

      console.warn('QR signing failed:', err);
    }
  }

  const encoded = encodePayload(payload);
  const imageUrl = getQRImageUrl(encoded, opts?.imageSize ?? 420);

  return { payload: encoded, imageUrl, raw: payload };
};

export default { generateAppointmentCheckinQRCode };
