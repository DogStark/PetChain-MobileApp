import Geolocation from '@react-native-community/geolocation';
import NetInfo from '@react-native-community/netinfo';
import { Linking, Platform } from 'react-native';

import apiClient from './apiClient';
import config from '../config';
import { getItem, setItem, removeItem as _removeItem } from './localDB';
import { requestAndroidPermission } from './permissionService';

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

  // ── Location ─────────────────────────────────────────────────────────────────

  async requestLocationPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      return requestAndroidPermission('android.permission.ACCESS_FINE_LOCATION', {
        title: 'Location Permission',
        message: 'PetChain needs your location to find nearby vet clinics.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      });
    }
    return true; // iOS prompts automatically via Geolocation.getCurrentPosition
  }

  /**
   * Gets current location with a 5-second timeout and fallback to last known location.
   */
  async getCurrentLocation(): Promise<Location> {
    const hasPermission = await this.requestLocationPermission();
    if (!hasPermission) throw new Error('Location permission denied');

    return new Promise((resolve) => {
      let resolved = false;

      // 5-second timeout for fresh GPS lock
      const timeout = setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          const lastLocation = await this.getLastKnownLocation();
          resolve(lastLocation);
        }
      }, 5000);

      Geolocation.getCurrentPosition(
        (position) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          }
        },
        async () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            const lastLocation = await this.getLastKnownLocation();
            resolve(lastLocation);
          }
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
      );
    });
  }

  /**
   * Fallback to last known location if GPS fails or times out.
   *
   * Resolves `{ latitude: 0, longitude: 0 }` when nothing is available. That
   * sentinel is retained only for map-centering callers that predate
   * `getLocationOrNull`; never use it on the SOS path — see the note there.
   */
  private async getLastKnownLocation(): Promise<Location> {
    const location = await this.getLastKnownLocationOrNull();
    return location ?? { latitude: 0, longitude: 0 };
  }

  private async getLastKnownLocationOrNull(): Promise<Location | null> {
    return new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 2000, maximumAge: Infinity },
      );
    });
  }

  /**
   * Resolve the device location, or `null` if it genuinely cannot be
   * determined (permission denied, GPS off, airplane mode with no fix).
   *
   * The SOS path must use this rather than {@link getCurrentLocation}: the
   * legacy `{ 0, 0 }` fallback is a real coordinate off the coast of Africa,
   * and a responder cannot tell it apart from a true position. Sending
   * "Null Island" during an emergency is worse than sending no location.
   */
  async getLocationOrNull(): Promise<Location | null> {
    const hasPermission = await this.requestLocationPermission();
    if (!hasPermission) return null;

    return new Promise((resolve) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        void this.getLastKnownLocationOrNull().then(resolve);
      }, 5000);

      Geolocation.getCurrentPosition(
        (position) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          void this.getLastKnownLocationOrNull().then(resolve);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
      );
    });
  }

  /** Whether the device currently has a usable network connection. */
  async isOnline(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      return state.isConnected === true;
    } catch {
      // Treat an unreadable network state as offline: the offline path is
      // strictly safer (no network disclosure, no silent failure).
      return false;
    }
  }

  // ── Nearby clinics ───────────────────────────────────────────────────────────

  async getNearbyVetClinics(
    latitude: number,
    longitude: number,
    radiusKm = 10,
  ): Promise<VetClinic[]> {
    const apiKey = config.googlePlaces.apiKey;
    if (apiKey) {
      try {
        return await this.fetchClinicsFromPlacesAPI(latitude, longitude, radiusKm, apiKey);
      } catch {
        // fall through to mock data
      }
    }
    return this.getMockClinics(latitude, longitude, radiusKm);
  }

  private async fetchClinicsFromPlacesAPI(
    latitude: number,
    longitude: number,
    radiusKm: number,
    apiKey: string,
  ): Promise<VetClinic[]> {
    const radiusMeters = radiusKm * 1000;
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${latitude},${longitude}` +
      `&radius=${radiusMeters}` +
      `&type=veterinary_care` +
      `&key=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Places API error: ${response.status}`);

    const data = (await response.json()) as {
      status: string;
      results: Array<{
        place_id: string;
        name: string;
        vicinity: string;
        geometry: { location: { lat: number; lng: number } };
        rating?: number;
        formatted_phone_number?: string;
      }>;
    };

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API status: ${data.status}`);
    }

    return (data.results ?? [])
      .map((place) => ({
        id: place.place_id,
        name: place.name,
        address: place.vicinity,
        phoneNumber: place.formatted_phone_number ?? '',
        latitude: place.geometry.location.lat,
        longitude: place.geometry.location.lng,
        rating: place.rating,
        available24h: false,
        distance: this.calculateDistance(
          latitude,
          longitude,
          place.geometry.location.lat,
          place.geometry.location.lng,
        ),
      }))
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  }

  private getMockClinics(latitude: number, longitude: number, radiusKm: number): VetClinic[] {
    const mockClinics: VetClinic[] = [
      {
        id: 'clinic-1',
        name: 'Emergency Vet Clinic',
        address: '123 Main St',
        phoneNumber: '555-0100',
        latitude: latitude + 0.01,
        longitude: longitude + 0.01,
        available24h: true,
        rating: 4.5,
      },
      {
        id: 'clinic-2',
        name: 'City Animal Hospital',
        address: '456 Oak Ave',
        phoneNumber: '555-0200',
        latitude: latitude - 0.02,
        longitude: longitude - 0.02,
        available24h: false,
        rating: 4.8,
      },
      {
        id: 'clinic-3',
        name: 'PetCare 24/7',
        address: '789 Elm Rd',
        phoneNumber: '555-0300',
        latitude: latitude + 0.03,
        longitude: longitude - 0.01,
        available24h: true,
        rating: 4.2,
      },
    ];

    return mockClinics
      .map((clinic) => ({
        ...clinic,
        distance: this.calculateDistance(latitude, longitude, clinic.latitude, clinic.longitude),
      }))
      .filter((clinic) => (clinic.distance ?? Infinity) <= radiusKm)
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  }

  // ── SOS ──────────────────────────────────────────────────────────────────────

  /**
   * Resolve the contacts an SOS may be sent to.
   *
   * Only contacts the user curated are eligible. The bundled `DEFAULT_CONTACTS`
   * are public poison-control hotlines seeded for convenience; they are
   * reachable by tapping "call" but are never valid targets for an automated
   * message containing the owner's location.
   */
  private async resolveRecipients(confirmedIds?: string[]): Promise<SOSRecipient[]> {
    const [contacts, favorites] = await Promise.all([
      this.getEmergencyContacts(),
      this.getFavoriteContacts(),
    ]);

    const toRecipient = (contact: EmergencyContact): SOSRecipient => ({
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      type: contact.type,
    });

    if (confirmedIds && confirmedIds.length > 0) {
      // Explicit user confirmation: honour exactly what was ticked, but resolve
      // against known contacts so an unknown id cannot inject a phone number.
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return confirmedIds
        .map((id) => byId.get(id))
        .filter((c): c is EmergencyContact => c != null)
        .map(toRecipient);
    }

    // No explicit confirmation: the user's own favourites only.
    return favorites.filter((c) => !this.isPublicHotline(c)).map(toRecipient);
  }

  /** Public hotlines must never be auto-messaged with a precise location. */
  private isPublicHotline(contact: EmergencyContact): boolean {
    return contact.type === 'poison-control' || DEFAULT_CONTACT_IDS.has(contact.id);
  }

  private buildMessage(
    message: string | undefined,
    shareUrl: string | null,
    location: Location | null,
  ): string {
    const body = message || 'Pet emergency - need immediate help';
    const lines = [`SOS EMERGENCY: ${body}`];

    if (shareUrl) {
      lines.push(`Live location: ${shareUrl}`);
    } else if (location) {
      lines.push(
        `Last known location: https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`,
      );
    } else {
      // State it explicitly rather than omitting the line: a responder needs to
      // know the location is unknown, not merely missing from the message.
      lines.push('Location unavailable on this device.');
    }

    return lines.join('\n');
  }

  /**
   * Build the reviewable plan for an SOS without sending anything.
   *
   * The UI must present this — recipients, message body, warnings — and obtain
   * confirmation before calling {@link triggerSOS}.
   */
  async prepareSOS(message?: string, options: TriggerSOSOptions = {}): Promise<SOSPlan> {
    const online = options.forceOffline === true ? false : await this.isOnline();
    const [location, recipients] = await Promise.all([
      this.getLocationOrNull(),
      this.resolveRecipients(options.confirmedRecipientIds),
    ]);

    const warnings: string[] = [];
    if (!online) {
      warnings.push('No network connection - live location sharing is unavailable.');
    }
    if (!location) {
      warnings.push('Location could not be determined - no coordinates will be shared.');
    }
    if (recipients.length === 0) {
      warnings.push('No emergency contacts selected - add or select a contact to send an SOS.');
    }

    const channels: SOSChannel[] = [];
    if (online) channels.push('live-session');
    if (recipients.length > 0) channels.push('sms', 'call');

    return {
      recipients,
      messagePreview: this.buildMessage(message, null, location),
      location,
      online,
      channels,
      canDispatch: recipients.length > 0,
      warnings,
    };
  }

  /**
   * One-tap SOS.
   *
   * Sends only to contacts the user selected (see {@link prepareSOS}), degrades
   * to call/SMS when offline, and never fabricates coordinates.
   */
  async triggerSOS(message?: string, options: TriggerSOSOptions = {}): Promise<SOSPayload> {
    const plan = await this.prepareSOS(message, options);

    // Only attempt the networked live-location session when actually online.
    // Offline, this previously burned the full request timeout before failing.
    const session = plan.online
      ? await this.startLiveLocationSession(
          plan.location,
          plan.recipients.map((r) => ({
            id: r.id,
            name: r.name,
            phoneNumber: r.phoneNumber,
            type: r.type,
          })),
          message,
        )
      : null;

    const payload: SOSPayload = {
      location: plan.location ?? undefined,
      timestamp: Date.now(),
      message: message || 'Pet emergency - need immediate help',
      sessionId: session?.id,
      shareToken: session?.shareToken,
      shareUrl: session?.shareUrl,
    };

    const fullMessage = this.buildMessage(message, session?.shareUrl ?? null, plan.location);

    // SMS only the confirmed recipients. `Linking` surfaces one composer at a
    // time, so all addressees ride on a single message.
    if (plan.recipients.length > 0) {
      this.sendSMS(plan.recipients.map((r) => r.phoneNumber).join(','), fullMessage);

      // Auto-call the primary responder. Never a poison-control hotline.
      const primary =
        plan.recipients.find((r) => r.type === 'emergency' || r.type === 'vet') ??
        plan.recipients[0];
      if (primary) this.callContact(primary.phoneNumber);
    }

    return payload;
  }

  // ── Call / Navigate ──────────────────────────────────────────────────────────

  callContact(phoneNumber: string): void {
    const url = `tel:${phoneNumber}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) Linking.openURL(url);
    });
  }

  sendSMS(phoneNumber: string, message: string): void {
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${phoneNumber}${separator}body=${encodeURIComponent(message)}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) Linking.openURL(url);
    });
  }

  async startLiveLocationSession(
    location: Location | null,
    contacts: Array<Pick<EmergencyContact, 'name' | 'phoneNumber'>>,
    message?: string,
    timeoutMinutes = 60,
  ): Promise<LiveSOSSession | null> {
    try {
      const response = await apiClient.post('/emergency/sessions', {
        message: message || 'Pet emergency - need immediate help',
        // Omitted entirely when unknown, so the backend never records 0,0.
        ...(location ? { latitude: location.latitude, longitude: location.longitude } : {}),
        timeoutMinutes,
        contacts: contacts.map((contact) => ({
          name: contact.name,
          phoneNumber: contact.phoneNumber,
        })),
      });
      return response.data?.data ?? response.data;
    } catch {
      return null;
    }
  }

  async updateLiveLocation(shareToken: string, location: Location): Promise<void> {
    await apiClient.post(`/emergency/sessions/${encodeURIComponent(shareToken)}/location`, {
      latitude: location.latitude,
      longitude: location.longitude,
    });
  }

  async cancelLiveLocationSession(shareToken: string): Promise<void> {
    await apiClient.post(`/emergency/sessions/${encodeURIComponent(shareToken)}/cancel`);
  }

  navigateToClinic(address: string): void {
    const encoded = encodeURIComponent(address);
    const url = Platform.select({
      ios: `maps:0,0?q=${encoded}`,
      android: `geo:0,0?q=${encoded}`,
    });

    if (url) {
      Linking.canOpenURL(url).then((supported) => {
        Linking.openURL(
          supported ? url : `https://www.google.com/maps/search/?api=1&query=${encoded}`,
        );
      });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

export default EmergencyService.getInstance();
