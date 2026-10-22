/**
 * Offline SOS privacy regression tests  (Issue #942)
 *
 * Two defects are pinned here:
 *
 * 1. **Unintended recipients.** `DEFAULT_CONTACTS` seeds two public
 *    poison-control hotlines, and the old `sendSOSAlerts` texted
 *    `contacts[0]` — so a first-run SOS sent the owner's precise coordinates
 *    to a national hotline and auto-dialled it. Nobody chose that.
 *
 * 2. **Fabricated location.** When GPS was unavailable the location fell back
 *    to `{ latitude: 0, longitude: 0 }` — a real point in the Gulf of Guinea
 *    that a responder cannot distinguish from a true fix.
 *
 * Airplane mode is simulated by driving the NetInfo mock, not by timing.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../config', () => ({
  __esModule: true,
  default: { googlePlaces: { apiKey: '' }, api: { baseUrl: 'https://api.test/api' } },
}));

const mockNetInfoState = { isConnected: true, type: 'wifi' };
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: async () => mockNetInfoState, addEventListener: () => () => undefined },
  fetch: async () => mockNetInfoState,
}));

/** Controls what the GPS mock reports: a fix, or a hard failure. */
const mockGps: { position: { latitude: number; longitude: number } | null } = { position: null };
jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: (
      success: (p: { coords: { latitude: number; longitude: number } }) => void,
      failure: (e: unknown) => void,
    ) => {
      if (mockGps.position) success({ coords: mockGps.position });
      else failure(new Error('position unavailable'));
    },
  },
}));

const mockOpenURL = jest.fn(async () => true);
jest.mock('react-native', () => ({
  Linking: {
    openURL: (...args: unknown[]) => mockOpenURL(...(args as [string])),
    canOpenURL: async () => true,
  },
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios },
}));

const mockApiPost = jest.fn();
jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockApiPost(...args) },
}));

/** In-memory stand-in for the local key/value store. */
const mockStore: Record<string, string> = {};
jest.mock('../localDB', () => ({
  getItem: async (k: string) => mockStore[k] ?? null,
  setItem: async (k: string, v: string) => {
    mockStore[k] = v;
  },
  removeItem: async (k: string) => {
    delete mockStore[k];
  },
}));

jest.mock('../permissionService', () => ({ requestAndroidPermission: async () => true }));

import emergencyService, { type EmergencyContact } from '../emergencyService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VET: EmergencyContact = {
  id: 'vet-1',
  name: 'Dr Okafor',
  phoneNumber: '555-0111',
  type: 'vet',
};

/** The SMS body handed to `Linking.openURL`, decoded. */
function sentSmsBody(): string | null {
  const call = mockOpenURL.mock.calls.find((c) => String(c[0]).startsWith('sms:'));
  if (!call) return null;
  const url = String(call[0]);
  return decodeURIComponent(url.slice(url.indexOf('body=') + 'body='.length));
}

function sentSmsRecipients(): string | null {
  const call = mockOpenURL.mock.calls.find((c) => String(c[0]).startsWith('sms:'));
  if (!call) return null;
  const url = String(call[0]);
  return url.slice('sms:'.length, url.search(/[?&]body=/));
}

function dialledNumbers(): string[] {
  return mockOpenURL.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('tel:'))
    .map((u) => u.slice('tel:'.length));
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockNetInfoState.isConnected = true;
  mockGps.position = { latitude: 6.5244, longitude: 3.3792 };
  mockApiPost.mockResolvedValue({
    data: { data: { id: 's1', shareToken: 'tok', shareUrl: 'https://x.test/s1', expiresAt: '' } },
  });
});

// ─── Unintended recipients ───────────────────────────────────────────────────

describe('recipient selection (Issue #942)', () => {
  it('never auto-sends to the bundled poison-control hotlines', async () => {
    // Fresh install: only DEFAULT_CONTACTS exist, no favourites.
    const plan = await emergencyService.prepareSOS('Help');

    expect(plan.recipients).toHaveLength(0);
    expect(plan.canDispatch).toBe(false);
    expect(plan.warnings.join(' ')).toMatch(/no emergency contacts/i);
  });

  it('sends nothing at all when no contact has been selected', async () => {
    await emergencyService.triggerSOS('Help');

    expect(sentSmsBody()).toBeNull();
    expect(dialledNumbers()).toEqual([]);
  });

  it('sends only to the contacts the user confirmed', async () => {
    await emergencyService.addContact(VET);
    const contacts = await emergencyService.getEmergencyContacts();
    const vet = contacts.find((c) => c.name === VET.name)!;

    await emergencyService.triggerSOS('Help', { confirmedRecipientIds: [vet.id] });

    expect(sentSmsRecipients()).toBe(VET.phoneNumber);
    // The bundled hotlines must not appear anywhere in the dispatch.
    expect(dialledNumbers()).toEqual([VET.phoneNumber]);
    expect(dialledNumbers()).not.toContain('855-764-7661');
  });

  it('ignores a recipient id that is not a known contact', async () => {
    await emergencyService.addContact(VET);

    const plan = await emergencyService.prepareSOS('Help', {
      confirmedRecipientIds: ['not-a-real-contact'],
    });

    expect(plan.recipients).toHaveLength(0);
  });

  it('falls back to favourites, excluding hotlines', async () => {
    await emergencyService.addContact(VET);
    const contacts = await emergencyService.getEmergencyContacts();
    const vet = contacts.find((c) => c.name === VET.name)!;
    await emergencyService.saveFavoriteContact(vet);
    await emergencyService.saveFavoriteContact(contacts.find((c) => c.id === 'default-1')!);

    const plan = await emergencyService.prepareSOS('Help');

    expect(plan.recipients.map((r) => r.name)).toEqual([VET.name]);
  });
});

// ─── Airplane mode ───────────────────────────────────────────────────────────

describe('offline behaviour (Issue #942)', () => {
  beforeEach(async () => {
    await emergencyService.addContact(VET);
    const contacts = await emergencyService.getEmergencyContacts();
    await emergencyService.saveFavoriteContact(contacts.find((c) => c.name === VET.name)!);
  });

  it('skips the live-location session entirely when offline', async () => {
    mockNetInfoState.isConnected = false;

    await emergencyService.triggerSOS('Help');

    expect(mockApiPost).not.toHaveBeenCalled();
    // Call and SMS still go out — that is the whole point of the fallback.
    expect(sentSmsBody()).toContain('SOS EMERGENCY');
    expect(dialledNumbers()).toEqual([VET.phoneNumber]);
  });

  it('reports offline degradation in the plan', async () => {
    mockNetInfoState.isConnected = false;

    const plan = await emergencyService.prepareSOS('Help');

    expect(plan.online).toBe(false);
    expect(plan.channels).not.toContain('live-session');
    expect(plan.channels).toEqual(expect.arrayContaining(['sms', 'call']));
    expect(plan.warnings.join(' ')).toMatch(/no network/i);
  });

  it('treats an unreadable network state as offline', async () => {
    const netinfo = jest.requireMock('@react-native-community/netinfo') as {
      default: { fetch: () => Promise<unknown> };
    };
    const original = netinfo.default.fetch;
    netinfo.default.fetch = async () => {
      throw new Error('bridge unavailable');
    };

    const plan = await emergencyService.prepareSOS('Help');
    expect(plan.online).toBe(false);

    netinfo.default.fetch = original;
  });

  it('uses the live share URL rather than raw coordinates when online', async () => {
    await emergencyService.triggerSOS('Help');

    expect(sentSmsBody()).toContain('https://x.test/s1');
    expect(sentSmsBody()).not.toContain('maps/search');
  });
});

// ─── Fabricated location ─────────────────────────────────────────────────────

describe('location handling (Issue #942)', () => {
  beforeEach(async () => {
    await emergencyService.addContact(VET);
    const contacts = await emergencyService.getEmergencyContacts();
    await emergencyService.saveFavoriteContact(contacts.find((c) => c.name === VET.name)!);
  });

  it('never reports 0,0 when the position is unknown', async () => {
    mockGps.position = null;
    mockNetInfoState.isConnected = false;

    const plan = await emergencyService.prepareSOS('Help');

    expect(plan.location).toBeNull();
    expect(plan.messagePreview).toContain('Location unavailable');
    expect(plan.messagePreview).not.toContain('query=0,0');
    expect(plan.warnings.join(' ')).toMatch(/location could not be determined/i);
  });

  it('omits the location from the payload when unknown', async () => {
    mockGps.position = null;
    mockNetInfoState.isConnected = false;

    const payload = await emergencyService.triggerSOS('Help');

    expect(payload.location).toBeUndefined();
    expect(sentSmsBody()).toContain('Location unavailable');
  });

  it('omits coordinates from the live session request when unknown', async () => {
    mockGps.position = null;

    await emergencyService.triggerSOS('Help');

    const body = mockApiPost.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty('latitude');
    expect(body).not.toHaveProperty('longitude');
  });

  it('includes real coordinates when a fix is available', async () => {
    mockNetInfoState.isConnected = false;

    const plan = await emergencyService.prepareSOS('Help');

    expect(plan.location).toEqual({ latitude: 6.5244, longitude: 3.3792 });
    expect(plan.messagePreview).toContain('query=6.5244,3.3792');
  });
});
