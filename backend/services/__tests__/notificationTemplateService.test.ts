/**
 * Tests for notificationTemplateService
 */

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../../src/db', () => ({ query: mockQuery }));

// ─── Mock cacheService ────────────────────────────────────────────────────────

const mockCacheGet = jest.fn().mockResolvedValue(null);
const mockCacheSet = jest.fn().mockResolvedValue(undefined);
const mockInvalidate = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/cacheService', () => ({
  cacheKey: (...parts: string[]) => `petchain:${parts.join(':')}`,
  get: mockCacheGet,
  set: mockCacheSet,
  invalidate: mockInvalidate,
}));

// ─── Mock pushService ─────────────────────────────────────────────────────────

const mockSendToUser = jest.fn().mockResolvedValue(1);

jest.mock('../../services/pushService', () => ({
  sendToUser: mockSendToUser,
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────

jest.mock('../../utils/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tmpl-1',
    key: 'medication_reminder',
    locale: 'en',
    title: 'Reminder: {{medicationName}}',
    body: 'Time to give {{petName}} their {{medicationName}}.',
    is_active: true,
    created_by: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

// ─── interpolate ─────────────────────────────────────────────────────────────

describe('interpolate', () => {
  let interpolate: (t: string, v: Record<string, string>) => string;

  beforeAll(async () => {
    ({ interpolate } = await import('../../services/notificationTemplateService'));
  });

  it('replaces all placeholders', () => {
    expect(interpolate('Hello {{name}}!', { name: 'Buddy' })).toBe('Hello Buddy!');
  });

  it('replaces multiple distinct placeholders', () => {
    const result = interpolate('{{a}} and {{b}}', { a: 'foo', b: 'bar' });
    expect(result).toBe('foo and bar');
  });

  it('throws on missing variable', () => {
    expect(() => interpolate('Hello {{name}}', {})).toThrow('Missing template variables: name');
  });

  it('throws listing all missing variables', () => {
    expect(() => interpolate('{{a}} {{b}}', {})).toThrow('a, b');
  });

  it('returns template unchanged when no placeholders', () => {
    expect(interpolate('No vars here', {})).toBe('No vars here');
  });
});

// ─── resolveTemplate ─────────────────────────────────────────────────────────

describe('resolveTemplate', () => {
  let resolveTemplate: (
    key: string,
    vars?: Record<string, string>,
    locale?: string,
  ) => Promise<{ title: string; body: string; locale: string }>;

  beforeAll(async () => {
    ({ resolveTemplate } = await import('../../services/notificationTemplateService'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
  });

  it('returns rendered template for exact locale match', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        makeRow({
          locale: 'es',
          title: 'Recordatorio: {{medicationName}}',
          body: 'Dale {{medicationName}} a {{petName}}.',
        }),
      ],
    });

    const result = await resolveTemplate(
      'medication_reminder',
      { medicationName: 'Aspirin', petName: 'Rex' },
      'es',
    );

    expect(result.locale).toBe('es');
    expect(result.title).toBe('Recordatorio: Aspirin');
    expect(result.body).toBe('Dale Aspirin a Rex.');
  });

  it('falls back to English when requested locale is missing', async () => {
    // First call (fr) returns nothing, second call (en) returns template
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [makeRow()] });

    const result = await resolveTemplate(
      'medication_reminder',
      { medicationName: 'Aspirin', petName: 'Rex' },
      'fr',
    );

    expect(result.locale).toBe('en');
    expect(result.title).toBe('Reminder: Aspirin');
  });

  it('uses English directly when locale is "en"', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow()] });

    const result = await resolveTemplate(
      'medication_reminder',
      { medicationName: 'Aspirin', petName: 'Rex' },
      'en',
    );

    expect(result.locale).toBe('en');
    // Only one DB call (no separate locale lookup)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('normalises locale tags (en-US → en)', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow()] });

    const result = await resolveTemplate(
      'medication_reminder',
      { medicationName: 'Aspirin', petName: 'Rex' },
      'en-US',
    );

    expect(result.locale).toBe('en');
  });

  it('throws when no template exists for key', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(resolveTemplate('nonexistent_key', {}, 'en')).rejects.toThrow(
      'No notification template found for key: "nonexistent_key"',
    );
  });

  it('throws when required variables are missing', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow()] });

    await expect(resolveTemplate('medication_reminder', { petName: 'Rex' }, 'en')).rejects.toThrow(
      'Missing template variables: medicationName',
    );
  });

  it('returns cached template without hitting DB', async () => {
    const cached = {
      id: 'tmpl-1',
      key: 'medication_reminder',
      locale: 'en',
      title: 'Reminder: {{medicationName}}',
      body: 'Give {{petName}} {{medicationName}}.',
      isActive: true,
      createdBy: null,
      createdAt: '',
      updatedAt: '',
    };
    mockCacheGet.mockResolvedValue(cached);

    await resolveTemplate('medication_reminder', { medicationName: 'X', petName: 'Y' }, 'en');

    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─── sendNotification ────────────────────────────────────────────────────────

describe('sendNotification', () => {
  let sendNotification: (
    userId: string,
    key: string,
    vars?: Record<string, string>,
    options?: { topic: string; data?: Record<string, unknown> },
  ) => Promise<{ enqueued: number; locale: string }>;

  beforeAll(async () => {
    ({ sendNotification } = await import('../../services/notificationTemplateService'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockSendToUser.mockResolvedValue(1);
  });

  /**
   * sendNotification issues two DB queries in sequence:
   *   1. SELECT preferred_language FROM users WHERE id = $1
   *   2. SELECT * FROM notification_templates WHERE key = $1 AND locale = $2 ...
   * (a second template query only happens if locale !== 'en' and falls back)
   */
  function mockUserThenTemplate(
    preferredLanguage: string | undefined,
    templateRows: Record<string, unknown>[],
  ) {
    mockQuery.mockResolvedValueOnce({ rows: [{ preferred_language: preferredLanguage }] });
    mockQuery.mockResolvedValueOnce({ rows: templateRows });
  }

  it('selects the template matching the user preferred_language', async () => {
    mockUserThenTemplate('es', [
      makeRow({
        key: 'vaccination_transfer',
        locale: 'es',
        title: '🐾 Recordatorios de vacunación transferidos',
        body: 'Los recordatorios de vacunación de {{petName}} ya están activos en tu cuenta.',
      }),
    ]);

    const result = await sendNotification(
      'user-1',
      'vaccination_transfer',
      { petName: 'Rex' },
      { topic: 'health_tips' },
    );

    expect(result.locale).toBe('es');
    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-1',
      'health_tips',
      '🐾 Recordatorios de vacunación transferidos',
      'Los recordatorios de vacunación de Rex ya están activos en tu cuenta.',
      undefined,
    );
  });

  it('falls back to English when the user locale has no template', async () => {
    // 1) user lookup → 'fr', 2) fr template lookup → none, 3) en fallback → found
    mockQuery
      .mockResolvedValueOnce({ rows: [{ preferred_language: 'fr' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          makeRow({
            key: 'vaccination_transfer',
            locale: 'en',
            title: '🐾 Vaccination reminders transferred',
            body: 'Vaccination reminders for {{petName}} are now active on your account.',
          }),
        ],
      });

    const result = await sendNotification(
      'user-2',
      'vaccination_transfer',
      { petName: 'Milo' },
      { topic: 'health_tips' },
    );

    expect(result.locale).toBe('en');
    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-2',
      'health_tips',
      '🐾 Vaccination reminders transferred',
      'Vaccination reminders for Milo are now active on your account.',
      undefined,
    );
  });

  it('defaults to English when the user has no preferred_language set', async () => {
    mockUserThenTemplate(undefined, [
      makeRow({
        key: 'vaccination_transfer',
        locale: 'en',
        title: '🐾 Vaccination reminders transferred',
        body: 'Vaccination reminders for {{petName}} are now active on your account.',
      }),
    ]);

    const result = await sendNotification(
      'user-3',
      'vaccination_transfer',
      { petName: 'Milo' },
      { topic: 'health_tips' },
    );

    expect(result.locale).toBe('en');
  });

  it('defaults to English when the user row is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        makeRow({
          key: 'vaccination_transfer',
          locale: 'en',
          title: '🐾 Vaccination reminders transferred',
          body: 'Vaccination reminders for {{petName}} are now active on your account.',
        }),
      ],
    });

    const result = await sendNotification(
      'missing-user',
      'vaccination_transfer',
      { petName: 'Milo' },
      { topic: 'health_tips' },
    );

    expect(result.locale).toBe('en');
  });

  it('passes through the data payload to sendToUser', async () => {
    mockUserThenTemplate('en', [
      makeRow({
        key: 'vaccination_transfer',
        locale: 'en',
        title: '🐾 Vaccination reminders transferred',
        body: 'Vaccination reminders for {{petName}} are now active on your account.',
      }),
    ]);

    await sendNotification(
      'user-4',
      'vaccination_transfer',
      { petName: 'Milo' },
      { topic: 'health_tips', data: { petId: 'pet-1' } },
    );

    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-4',
      'health_tips',
      expect.any(String),
      expect.any(String),
      { petId: 'pet-1' },
    );
  });

  it('returns the enqueued count from pushService.sendToUser', async () => {
    mockUserThenTemplate('en', [
      makeRow({
        key: 'vaccination_transfer',
        locale: 'en',
        title: 'T',
        body: 'B {{petName}}',
      }),
    ]);
    mockSendToUser.mockResolvedValue(3);

    const result = await sendNotification(
      'user-5',
      'vaccination_transfer',
      { petName: 'Milo' },
      { topic: 'health_tips' },
    );

    expect(result.enqueued).toBe(3);
  });

  it('throws when no template exists for the key in any locale', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ preferred_language: 'es' }] })
      .mockResolvedValueOnce({ rows: [] }) // es lookup
      .mockResolvedValueOnce({ rows: [] }); // en fallback lookup

    await expect(
      sendNotification('user-6', 'nonexistent_key', {}, { topic: 'health_tips' }),
    ).rejects.toThrow('No notification template found for key: "nonexistent_key"');

    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it('throws when required variables are missing and does not send', async () => {
    mockUserThenTemplate('en', [
      makeRow({
        key: 'vaccination_transfer',
        locale: 'en',
        title: 'T',
        body: 'B {{petName}}',
      }),
    ]);

    await expect(
      sendNotification('user-7', 'vaccination_transfer', {}, { topic: 'health_tips' }),
    ).rejects.toThrow('Missing template variables: petName');

    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it('normalises a region-tagged user locale (es-MX → es)', async () => {
    mockUserThenTemplate('es-MX', [
      makeRow({
        key: 'vaccination_transfer',
        locale: 'es',
        title: 'T',
        body: 'B {{petName}}',
      }),
    ]);

    const result = await sendNotification(
      'user-8',
      'vaccination_transfer',
      { petName: 'Milo' },
      { topic: 'health_tips' },
    );

    expect(result.locale).toBe('es');
  });
});

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

describe('createTemplate', () => {
  let createTemplate: (input: Record<string, unknown>) => Promise<unknown>;

  beforeAll(async () => {
    ({ createTemplate } = await import('../../services/notificationTemplateService'));
  });

  beforeEach(() => jest.clearAllMocks());

  it('inserts and returns the new template', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow()] });

    const result = (await createTemplate({
      key: 'medication_reminder',
      locale: 'en',
      title: 'Reminder: {{medicationName}}',
      body: 'Time to give {{petName}} their {{medicationName}}.',
    })) as { key: string; locale: string };

    expect(result.key).toBe('medication_reminder');
    expect(result.locale).toBe('en');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notification_templates'),
      expect.any(Array),
    );
  });
});

describe('updateTemplate', () => {
  let updateTemplate: (id: string, input: Record<string, unknown>) => Promise<unknown>;

  beforeAll(async () => {
    ({ updateTemplate } = await import('../../services/notificationTemplateService'));
  });

  beforeEach(() => jest.clearAllMocks());

  it('updates and invalidates cache', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow({ title: 'Updated Title' })] });

    const result = (await updateTemplate('tmpl-1', { title: 'Updated Title' })) as {
      title: string;
    };

    expect(result.title).toBe('Updated Title');
    expect(mockInvalidate).toHaveBeenCalledWith(expect.stringContaining('medication_reminder'));
  });

  it('returns null when template not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await updateTemplate('missing-id', { title: 'X' });
    expect(result).toBeNull();
  });
});

describe('deleteTemplate', () => {
  let deleteTemplate: (id: string) => Promise<boolean>;
  let getTemplateById: (id: string) => Promise<unknown>;

  beforeAll(async () => {
    ({ deleteTemplate, getTemplateById } = await import(
      '../../services/notificationTemplateService'
    ));
  });

  beforeEach(() => jest.clearAllMocks());

  it('deletes and invalidates cache', async () => {
    // getTemplateById → found; DELETE → ok
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] }).mockResolvedValueOnce({ rows: [] });

    const result = await deleteTemplate('tmpl-1');

    expect(result).toBe(true);
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('returns false when template not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await deleteTemplate('missing-id');
    expect(result).toBe(false);
  });
});
