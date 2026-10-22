import apiClient from './apiClient';
import emergencyService, { type EmergencyContact } from './emergencyService';
import {
  addDoseLog,
  clearDoseLogs,
  deleteMedicationById,
  getAllMedications,
  getDoseLogs,
  getItem,
  removeItem,
  setItem,
  upsertMedication,
} from './localDB';
import type { Medication } from './medicationService';
import { getPreferences, savePreferences } from './notificationService';
import petService, { type Pet } from './petService';
import { getUserProfile, saveUserProfile } from './userService';
import type { User, NotificationPreferences } from '../models/User';
import { getPhoto } from '../utils/petPhotoStore';

const _USER_PROFILE_KEY = '@user_profile';
const _NOTIFICATION_PREFS_KEY = '@notification_preferences';
const NOTIFICATION_MAP_KEY = '@notification_map';
const PETS_LIST_KEY = '@pets_list';
const PET_PREFIX_KEY = '@pet_';
const EMERGENCY_CONTACTS_KEY = '@emergency_contacts';
const EMERGENCY_FAVORITES_KEY = '@emergency_favorites';
const PET_PHOTOS_KEY = '@pet_photos';

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  medicationReminders: true,
  appointmentReminders: true,
  vaccinationAlerts: true,
  reminderLeadTimeMinutes: 60,
  soundEnabled: true,
  vibrationEnabled: true,
  badgeEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  petOverrides: [],
};

export interface BackupSnapshot {
  version: 1;
  createdAt: string;
  userProfile: User | null;
  notificationPreferences: NotificationPreferences;
  notificationMap: Record<string, string[]>;
  pets: Pet[];
  medications: Medication[];
  doseLogs: Array<Record<string, unknown>>;
  emergencyContacts: EmergencyContact[];
  favoriteEmergencyContacts: EmergencyContact[];
  petPhotos: Record<string, string>;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data as T;
  }
  return payload as T;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await setItem(key, JSON.stringify(value));
}

async function replacePets(pets: Pet[]): Promise<void> {
  const currentPets = await petService.getAllPets().catch(() => [] as Pet[]);
  await Promise.all(currentPets.map((pet) => removeItem(`${PET_PREFIX_KEY}${pet.id}`)));
  await writeJson(PETS_LIST_KEY, pets);
  await Promise.all(pets.map((pet) => writeJson(`${PET_PREFIX_KEY}${pet.id}`, pet)));
}

async function replaceMedications(medications: Medication[]): Promise<void> {
  const current = await getAllMedications<Medication>().catch(() => [] as Medication[]);
  await Promise.all(current.map((medication) => deleteMedicationById(medication.id)));
  await Promise.all(medications.map((medication) => upsertMedication(medication)));
}

async function replaceDoseLogs(doseLogs: Array<Record<string, unknown>>): Promise<void> {
  await clearDoseLogs();
  await Promise.all(doseLogs.map((log) => addDoseLog(log as Parameters<typeof addDoseLog>[0])));
}

async function replaceContacts(
  contacts: EmergencyContact[],
  favorites: EmergencyContact[],
): Promise<void> {
  await writeJson(EMERGENCY_CONTACTS_KEY, contacts);
  await writeJson(EMERGENCY_FAVORITES_KEY, favorites);
}

async function replaceNotificationMap(map: Record<string, string[]>): Promise<void> {
  await writeJson(NOTIFICATION_MAP_KEY, map);
}

async function replacePetPhotos(petPhotos: Record<string, string>): Promise<void> {
  await writeJson(PET_PHOTOS_KEY, petPhotos);
}

export async function createBackupSnapshot(): Promise<BackupSnapshot> {
  const [userProfile, notificationPreferences, pets, medications, doseLogs] = await Promise.all([
    getUserProfile().catch(() => null),
    getPreferences().catch(() => DEFAULT_NOTIFICATION_PREFERENCES),
    petService.getAllPets().catch(() => [] as Pet[]),
    getAllMedications<Medication>().catch(() => [] as Medication[]),
    getDoseLogs<Record<string, unknown>>().catch(() => [] as Array<Record<string, unknown>>),
  ]);

  const [emergencyContacts, favoriteEmergencyContacts] = await Promise.all([
    emergencyService.getEmergencyContacts().catch(() => [] as EmergencyContact[]),
    emergencyService.getFavoriteContacts().catch(() => [] as EmergencyContact[]),
  ]);

  const petPhotosEntries = await Promise.all(
    pets.map(async (pet) => [pet.id, (await getPhoto(pet.id)) ?? ''] as const),
  );

  const petPhotos = Object.fromEntries(
    petPhotosEntries.filter(([, uri]) => Boolean(uri)),
  ) as Record<string, string>;

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    userProfile,
    notificationPreferences,
    notificationMap: await readJson<Record<string, string[]>>(NOTIFICATION_MAP_KEY, {}),
    pets,
    medications,
    doseLogs,
    emergencyContacts,
    favoriteEmergencyContacts,
    petPhotos,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await createBackupSnapshot(), null, 2);
}

export async function restoreBackupSnapshot(snapshot: BackupSnapshot): Promise<void> {
  if (snapshot.userProfile) {
    await saveUserProfile(snapshot.userProfile);
  }

  await savePreferences(snapshot.notificationPreferences);
  await replaceNotificationMap(snapshot.notificationMap ?? {});
  await replacePets(snapshot.pets ?? []);
  await replaceMedications(snapshot.medications ?? []);
  await replaceDoseLogs(snapshot.doseLogs ?? []);
  await replaceContacts(snapshot.emergencyContacts ?? [], snapshot.favoriteEmergencyContacts ?? []);
  await replacePetPhotos(snapshot.petPhotos ?? {});
}

export async function restoreBackupJson(raw: string): Promise<void> {
  const parsed = JSON.parse(raw) as BackupSnapshot;
  if (parsed.version !== 1) {
    throw new Error('Unsupported backup version');
  }
  await restoreBackupSnapshot(parsed);
}

export async function backupToCloud(snapshot?: BackupSnapshot): Promise<void> {
  const payload = snapshot ?? (await createBackupSnapshot());
  await apiClient.post('/backups/me', payload);
}

export async function restoreFromCloud(): Promise<BackupSnapshot> {
  const response = await apiClient.get('/backups/me');
  const snapshot = unwrap<BackupSnapshot>(response.data);
  if (!snapshot) {
    throw new Error('No cloud backup found');
  }
  await restoreBackupSnapshot(snapshot);
  return snapshot;
}
