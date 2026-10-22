/**
 * Veterinarian & Clinic data models for the PetChain mobile app.
 *
 * Captures contact information, location, and specialisations for vets and the
 * clinics they practise at. Kept dependency-free so it can be shared across
 * services, screens, and offline caches.
 */

// ─── Shared value types ───────────────────────────────────────────────────────

/** Contact details shared by veterinarians and clinics. */
export interface ContactInfo {
  phone?: string;
  email?: string;
  website?: string;
}

/** Geographic coordinates (WGS-84 decimal degrees). */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Postal address for a clinic. */
export interface ClinicAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** Common veterinary areas of specialisation. */
export type VetSpecialisation =
  | 'general_practice'
  | 'surgery'
  | 'dentistry'
  | 'dermatology'
  | 'cardiology'
  | 'oncology'
  | 'orthopedics'
  | 'ophthalmology'
  | 'internal_medicine'
  | 'emergency_critical_care'
  | 'exotic_animals'
  | 'behaviour'
  | 'nutrition'
  | 'other';

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/** Opening/closing time for a single day, in 24-hour `HH:mm` format. */
export interface DayHours {
  open: string; // 'HH:mm'
  close: string; // 'HH:mm'
}

/**
 * Weekly opening hours. A day mapped to `'closed'` (or omitted) is treated as
 * not open that day.
 */
export type ClinicHours = Partial<Record<DayOfWeek, DayHours | 'closed'>>;

// ─── Veterinarian ─────────────────────────────────────────────────────────────

export interface Vet {
  id: string;
  name: string;
  /** Primary area of specialisation. */
  specialisation: VetSpecialisation;
  /** Additional specialisations, if the vet covers more than one area. */
  specialisations?: VetSpecialisation[];
  /** Clinic the vet primarily practises at. */
  clinicId: string;
  /** Professional licence / registration number. */
  licenseNumber: string;
  /** How to reach the vet directly. */
  contact: ContactInfo;
  yearsOfExperience?: number;
  photoUrl?: string;
  bio?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Alias for callers that prefer the fuller noun. */
export type Veterinarian = Vet;

// ─── Clinic ───────────────────────────────────────────────────────────────────

export interface Clinic {
  id: string;
  name: string;
  address: ClinicAddress;
  coordinates: Coordinates;
  phone: string;
  /** Weekly opening hours keyed by day of week. */
  hours: ClinicHours;
  /** Whether the clinic offers emergency / after-hours care. */
  emergencyAvailable: boolean;
  contact?: ContactInfo;
  /** IDs of vets that practise at this clinic. */
  vetIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

// ─── Factories ────────────────────────────────────────────────────────────────

/**
 * Safely build a {@link Vet} from partial/raw data, applying sensible defaults
 * for required fields. Mirrors the factory convention used by other models.
 */
export const createVet = (data: Partial<Vet>): Vet => ({
  id: data.id ?? '',
  name: data.name ?? 'Unknown Vet',
  specialisation: data.specialisation ?? 'general_practice',
  specialisations: data.specialisations,
  clinicId: data.clinicId ?? '',
  licenseNumber: data.licenseNumber ?? '',
  contact: data.contact ?? {},
  yearsOfExperience: data.yearsOfExperience,
  photoUrl: data.photoUrl,
  bio: data.bio,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
});

/**
 * Safely build a {@link Clinic} from partial/raw data, applying sensible
 * defaults for required fields.
 */
export const createClinic = (data: Partial<Clinic>): Clinic => ({
  id: data.id ?? '',
  name: data.name ?? 'Unknown Clinic',
  address: data.address ?? {},
  coordinates: data.coordinates ?? { latitude: 0, longitude: 0 },
  phone: data.phone ?? '',
  hours: data.hours ?? {},
  emergencyAvailable: data.emergencyAvailable ?? false,
  contact: data.contact,
  vetIds: data.vetIds,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
});
