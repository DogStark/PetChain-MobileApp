import Geolocation from '@react-native-community/geolocation';
import NetInfo from '@react-native-community/netinfo';
import { Linking, Platform } from 'react-native';

import apiClient from './apiClient';
import config from '../config';
import { getItem, setItem, removeItem as _removeItem } from './localDB';
import { requestForegroundLocationPermission } from './permissionService';

// ─── Permission rationale (exported for UI layer / tests) ─────────────────────

export const LOCATION_PERMISSION_RATIONALE = {
  title: 'Location Access for Emergency',
  message:
    'PetChain uses your location only while the app is open to find nearby vet clinics and send your position during an SOS. Your location is never stored or shared without your action.',
  buttonPositive: 'Allow While Using App',
  buttonNegative: 'Not Now',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmergencyContact {
  id: string;
  name: string;
  phoneNumber: string;
  address?: string;
  type: 'vet' | 'clinic' | 'emergency' | 'poison-control';
  available24h?: boolean;
  notes?: string;
}

export interface VetClinic {
  id: string;
  name: string;
  address: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  distance?: number; // km
  rating?: number;
  available24h?: boolean;
}

export interface Location {
  latitude: number;
  longitude: number;
}

export interface SOSPayload {
  /** Absent when the device could not determine a position — never faked. */
  location?: Location;
  timestamp: number;
  message?: string;
  sessionId?: string;
  shareToken?: string;
  shareUrl?: string;
}

interface LiveSOSSession {
  id: string;
  shareToken: string;
  shareUrl: string;
  expiresAt: string;
}

// ─── SOS dispatch planning (Issue #942) ───────────────────────────────────────

/** A channel the SOS can go out on, in escalating order of reliability. */
export type SOSChannel = 'live-session' | 'sms' | 'call';

/** A contact that has been explicitly selected to receive an SOS. */
export interface SOSRecipient {
  id: string;
  name: string;
  phoneNumber: string;
  type: EmergencyContact['type'];
}

/**
 * The exact, reviewable plan for an SOS dispatch.
 *
 * `prepareSOS` builds this so the UI can show the user precisely who will be
 * contacted and what they will receive *before* anything is sent. Nothing in
 * this object is a guess: `messagePreview` is the literal SMS body and
 * `recipients` is the literal recipient list.
 */
export interface SOSPlan {
  /** Contacts that will receive the message, in dispatch order. */
  recipients: SOSRecipient[];
  /** Verbatim SMS body — show this to the user, do not paraphrase it. */
  messagePreview: string;
  /** Resolved coordinates, or `null` when the device could not determine them. */
  location: Location | null;
  /** Whether the device has a usable network connection right now. */
  online: boolean;
  /** Channels that will actually be used given current connectivity. */
  channels: SOSChannel[];
  /** False when there is no one to send to — the UI must block dispatch. */
  canDispatch: boolean;
  /** Human-readable reasons the plan is degraded, for display in the preview. */
  warnings: string[];
}

export interface TriggerSOSOptions {
  /**
   * IDs of contacts the user explicitly confirmed in the preview.
   *
   * When omitted, only **favourite** contacts are used. The bundled
   * `DEFAULT_CONTACTS` (public poison-control hotlines) are deliberately never
   * auto-selected: texting a national hotline the owner's home coordinates is
   * both useless to them and a disclosure the user never agreed to.
   */
  confirmedRecipientIds?: string[];
  /** Override connectivity detection. Tests use this to simulate airplane mode. */
  forceOffline?: boolean;
}

// ─── Emergency directory (Issue #1157) ────────────────────────────────────────

/** A single opening interval within a week, expressed in local minutes. */
export interface ClinicHoursInterval {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** Minutes from midnight, inclusive. */
  openMinute: number;
  /** Minutes from midnight, exclusive. */
  closeMinute: number;
}

/** A directory entry with clinic hours and provenance metadata. */
export interface EmergencyDirectoryEntry {
  id: string;
  name: string;
  phoneNumber: string;
  address?: string;
  type: EmergencyContact['type'];
  available24h?: boolean;
  /** Weekly opening intervals. Empty/absent means hours are unknown. */
  hours?: ClinicHoursInterval[];
  /** ISO timestamp of when the source data was last confirmed. */
  sourceUpdatedAt?: string;
}

/** Freshness classification for directory source data. */
export type DirectoryFreshness = 'fresh' | 'stale' | 'unknown';

/** A directory entry annotated with computed open state and freshness. */
export interface EmergencyDirectoryItem extends EmergencyDirectoryEntry {
  /** True when the clinic is open at the reference time. */
  isOpen: boolean;
  /** True when the clinic is open 24h or has no hours (assumed reachable). */
  isAlwaysAvailable: boolean;
  freshness: DirectoryFreshness;
  /** Human-readable hours summary for display. */
  hoursLabel: string;
}

/** Result of loading the emergency directory. */
export interface EmergencyDirectoryResult {
  items: EmergencyDirectoryItem[];
  /** True when the directory came from cache because the network failed. */
  fromCache: boolean;
  /** True when no directory data could be loaded at all. */
  unavailable: boolean;
  /** Freshness of the freshest source in the result. */
  freshness: DirectoryFreshness;
  /** Emergency-services fallback path when the directory is unavailable. */
  emergencyFallback: EmergencyFallback;
}

/** Explicit path to emergency services when directory data is unavailable. */
export interface EmergencyFallback {
  /** Dialable emergency number for the platform region. */
  emergencyNumber: string;
  /** Human-readable label for the emergency number. */
  label: string;
  /** Guidance shown to the user when the directory cannot be used. */
  guidance: string;
}

/** Age after which directory source data is considered stale. */
export const DIRECTORY_STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const DIRECTORY_CACHE_KEY = '@emergency_directory_cache';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const CONTACTS_KEY = '@emergency_contacts';
const FAVORITES_KEY = '@emergency_favorites';

// ─── Default contacts ─────────────────────────────────────────────────────────

/**
 * Seed contacts written on first launch.
 *
 * Frozen because `getEmergencyContacts` used to hand this exact array to
 * callers, and `addContact` pushed straight into it — permanently corrupting
 * the defaults for the rest of the process. Freezing makes any regression of
 * that kind fail loudly instead of silently.
 */
const DEFAULT_CONTACTS: readonly EmergencyContact[] = Object.freeze([
  {
    id: 'default-1',
    name: 'Pet Poison Helpline',
    phoneNumber: '855-764-7661',
    type: 'poison-control',
    available24h: true,
    notes: 'Fee may apply',
  },
  {
    id: 'default-2',
    name: 'ASPCA Animal Poison Control',
    phoneNumber: '888-426-4435',
    type: 'poison-control',
    available24h: true,
    notes: 'Fee may apply',
  },
]);

/** Ids of the bundled hotlines, captured before anything can mutate them. */
const DEFAULT_CONTACT_IDS: ReadonlySet<string> = new Set(DEFAULT_CONTACTS.map((c) => c.id));

// ─── EmergencyService ─────────────────────────────────────────────────────────

class EmergencyService {
  private static instance: EmergencyService;

  static getInstance(): EmergencyService {
    if (!EmergencyService.instance) {
      EmergencyService.instance = new EmergencyService();
    }
    return EmergencyService.instance;
  }

  // ── Contacts CRUD ────────────────────────────────────────────────────────────

  async getEmergencyContacts(): Promise<EmergencyContact[]> {
    const stored = await getItem(CONTACTS_KEY);
    if (stored) return JSON.parse(stored);
    await setItem(CONTACTS_KEY, JSON.stringify(DEFAULT_CONTACTS));
    // Copy: callers (notably `addContact`) mutate the array they receive.
    return DEFAULT_CONTACTS.map((contact) => ({ ...contact }));
  }

  async addContact(contact: Omit<EmergencyContact, 'id'>): Promise<EmergencyContact> {
    const contacts = await this.getEmergencyContacts();
    const newContact: EmergencyContact = {
      ...contact,
      id: `contact_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };
    contacts.push(newContact);
    await setItem(CONTACTS_KEY, JSON.stringify(contacts));
    return newContact;
  }

  async updateContact(
    id: string,
    updates: Partial<Omit<EmergencyContact, 'id'>>,
  ): Promise<EmergencyContact> {
    const contacts = await this.getEmergencyContacts();
    const idx = contacts.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Contact not found');
    contacts[idx] = { ...contacts[idx], ...updates };
    await setItem(CONTACTS_KEY, JSON.stringify(contacts));
    return contacts[idx];
  }

  async deleteContact(id: string): Promise<void> {
    const contacts = await this.getEmergencyContacts();
    const filtered = contacts.filter((c) => c.id !== id);
    await setItem(CONTACTS_KEY, JSON.stringify(filtered));
    // Also remove from favorites if present
    await this.removeFavoriteContact(id);
  }

  // ── Favorites ────────────────────────────────────────────────────────────────

  async getFavoriteContacts(): Promise<EmergencyContact[]> {
    const stored = await getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  async saveFavoriteContact(contact: EmergencyContact): Promise<void> {
    const favorites = await this.getFavoriteContacts();
    if (!favorites.find((f) => f.id === contact.id)) {
      favorites.push(contact);
      await setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }
  }

  async removeFavoriteContact(contactId: string): Promise<void> {
    const favorites = await this.getFavoriteContacts();
    await setItem(FAVORITES_KEY, JSON.stringify(favorites.filter((f) => f.id !== contactId)));
  }

  // ── Emergency directory (Issue #1157) ────────────────────────────────────────

  /**
   * Loads the clinic-hours aware emergency directory.
   *
   * Tries the network first; on failure falls back to the last cached copy so
   * offline behaviour is preserved. When neither is available the result is
   * marked `unavailable` and carries an explicit emergency-services fallback.
   */
  async getEmergencyDirectory(
    options: { now?: Date; forceOffline?: boolean } = {},
  ): Promise<EmergencyDirectoryResult> {
    const now = options.now ?? new Date();
    let entries: EmergencyDirectoryEntry[] | null = null;
    let fromCache = false;

    const online = options.forceOffline ? false : await this.isOnline();

    if (online) {
      try {
        const response = await apiClient.get('/emergency/directory');
        const data = response?.data?.entries ?? response?.data ?? [];
        if (Array.isArray(data)) {
          entries = data as EmergencyDirectoryEntry[];
          await setItem(DIRECTORY_CACHE_KEY, JSON.stringify(entries));
        }
      } catch {
        entries = null;
      }
    }

    if (!entries) {
      const cached = await getItem(DIRECTORY_CACHE_KEY);
      if (cached) {
        try {
          entries = JSON.parse(cached) as EmergencyDirectoryEntry[];
          fromCache = true;
        } catch {
          entries = null;
        }
      }
    }

    const emergencyFallback = this.getEmergencyFallback();

    if (!entries || entries.length === 0) {
      return {
        items: [],
        fromCache,
        unavailable: true,
        freshness: 'unknown',
        emergencyFallback,
      };
    }

    const items = entries.map((entry) => this.annotateDirectoryEntry(entry, now));
    const freshness = this.worstFreshness(items.map((i) => i.freshness));

    return {
      items,
      fromCache,
      unavailable: false,
      freshness,
      emergencyFallback,
    };
  }

  /** Computes open state, freshness, and hours label for a directory entry. */
  annotateDirectoryEntry(
    entry: EmergencyDirectoryEntry,
    now: Date = new Date(),
  ): EmergencyDirectoryItem {
    const isAlwaysAvailable = entry.available24h === true || !entry.hours || entry.hours.length === 0;
    const isOpen = isAlwaysAvailable ? true : this.isOpenAt(entry.hours!, now);
    const freshness = this.classifyFreshness(entry.sourceUpdatedAt, now);
    return {
      ...entry,
      isOpen,
      isAlwaysAvailable,
      freshness,
      hoursLabel: this.formatHoursLabel(entry),
    };
  }

  /** True when `now` falls inside any of the entry's opening intervals. */
  isOpenAt(hours: ClinicHoursInterval[], now: Date): boolean {
    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();
    return hours.some(
      (interval) =>
        interval.day === day &&
        minute >= interval.openMinute &&
        minute < interval.closeMinute,
    );
  }

  /** Classifies source freshness relative to `now`. */
  classifyFreshness(sourceUpdatedAt: string | undefined, now: Date = new Date()): DirectoryFreshness {
    if (!sourceUpdatedAt) return 'unknown';
    const updated = new Date(sourceUpdatedAt).getTime();
    if (Number.isNaN(updated)) return 'unknown';
    return now.getTime() - updated > DIRECTORY_STALE_AFTER_MS ? 'stale' : 'fresh';
  }

  /** Human-readable hours summary for display. */
  formatHoursLabel(entry: EmergencyDirectoryEntry): string {
    if (entry.available24h) return 'Open 24 hours';
    if (!entry.hours || entry.hours.length === 0) return 'Hours unavailable';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return entry.hours
      .map((interval) => {
        const open = this.formatMinute(interval.openMinute);
        const close = this.formatMinute(interval.closeMinute);
        return `${dayNames[interval.day] ?? '?'} ${open}–${close}`;
      })
      .join(', ');
  }

  /** Explicit path to emergency services when directory data is unavailable. */
  getEmergencyFallback(): EmergencyFallback {
    const emergencyNumber = Platform.OS === 'ios' ? '911' : '911';
    return {
      emergencyNumber,
      label: 'Emergency services',
      guidance:
        'Directory data is unavailable. If this is a life-threatening emergency, call emergency services directly.',
    };
  }

  /** Opens the dialer for a directory entry's phone number. */
  async callDirectoryEntry(phoneNumber: string): Promise<void> {
    const url = `tel:${phoneNumber.replace(/[^0-9+]/g, '')}`;
    await Linking.openURL(url);
  }

  /** Opens the dialer for the emergency-services fallback. */
  async callEmergencyServices(): Promise<void> {
    const { emergencyNumber } = this.getEmergencyFallback();
    await Linking.openURL(`tel:${emergencyNumber}`);
  }

  private formatMinute(minute: number): string {
    const h = Math.floor(minute / 60) % 24;
    const m = minute % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private worstFreshness(values: DirectoryFreshness[]): DirectoryFreshness {
    if (values.includes('unknown')) return 'unknown';
    if (values.includes('stale')) return 'stale';
    return 'fresh';
  }

  private async isOnline(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      return state.isConnected !== false;
    } catch {
      return true;
    }
  }

  // ── Location ─────────────────────────────────────────────────────────────────

  /**
   * Requests foreground-only location permission with a purpose explanation.
   * Uses coarse location (least privilege). Never requests background access.
   *
   * iOS: triggers the syste

/* … truncated 16254 chars — edit only what you need near the top … */
