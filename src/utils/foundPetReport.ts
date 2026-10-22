/**
 * Structured found-pet report helpers.
 *
 * Privacy defaults: contact details are not shared unless the finder opts in,
 * publishing requires explicit consent, and the published location is coarsened
 * so it helps owners search without pinpointing an address. Drafts never store
 * coordinates; the precise location is read from the device at publish time.
 */

export type ContactPreference = 'none' | 'in_app' | 'phone';

export interface FoundPetDraft {
  title: string;
  species: string;
  breed: string;
  description: string;
  photoUrl?: string;
  /** ISO timestamp of when the pet was found */
  foundAt: string;
  contactPreference: ContactPreference;
  consentToPublish: boolean;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type FoundPetDraftField = 'title' | 'species' | 'foundAt' | 'consent';

export type FoundPetDraftErrors = Partial<Record<FoundPetDraftField, string>>;

/** Two decimal places is roughly a 1.1 km grid */
const APPROXIMATE_LOCATION_DECIMALS = 2;

const HOUR_MS = 60 * 60 * 1000;

/** Drafts older than this are discarded so stale details are not published */
export const DRAFT_MAX_AGE_MS = 7 * 24 * HOUR_MS;

export const FOUND_TIME_OPTIONS = [
  { key: 'now', label: 'Just now', hoursAgo: 0 },
  { key: '1h', label: '1 hour ago', hoursAgo: 1 },
  { key: '6h', label: '6 hours ago', hoursAgo: 6 },
  { key: '24h', label: 'Yesterday', hoursAgo: 24 },
] as const;

export const CONTACT_PREFERENCE_OPTIONS: { value: ContactPreference; label: string }[] = [
  { value: 'none', label: "Don't share contact" },
  { value: 'in_app', label: 'In-app messages' },
  { value: 'phone', label: 'Phone call' },
];

export const createEmptyFoundPetDraft = (now: number = Date.now()): FoundPetDraft => ({
  title: '',
  species: '',
  breed: '',
  description: '',
  photoUrl: undefined,
  foundAt: new Date(now).toISOString(),
  contactPreference: 'none',
  consentToPublish: false,
});

export const foundAtFromHoursAgo = (hoursAgo: number, now: number = Date.now()): string =>
  new Date(now - hoursAgo * HOUR_MS).toISOString();

export const approximateLocation = (location: Coordinates): Coordinates => {
  const factor = 10 ** APPROXIMATE_LOCATION_DECIMALS;
  return {
    latitude: Math.round(location.latitude * factor) / factor,
    longitude: Math.round(location.longitude * factor) / factor,
  };
};

export const isDraftExpired = (savedAt: number, now: number = Date.now()): boolean =>
  now - savedAt > DRAFT_MAX_AGE_MS;

/**
 * Drafts are saved without validation so work is never lost. Publishing requires
 * a title, species, a valid non-future find time, and explicit consent.
 */
export const validateFoundPetDraft = (
  draft: FoundPetDraft,
  mode: 'draft' | 'publish',
  now: number = Date.now(),
): FoundPetDraftErrors => {
  const errors: FoundPetDraftErrors = {};

  if (mode === 'publish') {
    if (!draft.title.trim()) errors.title = 'Title is required.';
    if (!draft.species.trim()) errors.species = 'Species is required.';

    const foundAtMs = Date.parse(draft.foundAt);
    if (Number.isNaN(foundAtMs)) {
      errors.foundAt = 'Choose when the pet was found.';
    } else if (foundAtMs > now) {
      errors.foundAt = 'The find time cannot be in the future.';
    }

    if (!draft.consentToPublish) {
      errors.consent = 'Confirm consent before publishing.';
    }
  }

  return errors;
};

export const toFoundPetReportPayload = (draft: FoundPetDraft, location: Coordinates) => ({
  type: 'found' as const,
  title: draft.title.trim(),
  description: draft.description.trim(),
  species: draft.species.trim(),
  breed: draft.breed.trim() || undefined,
  photoUrl: draft.photoUrl,
  location: approximateLocation(location),
  foundAt: draft.foundAt,
  contactPreference: draft.contactPreference,
  consentToPublish: draft.consentToPublish,
});
