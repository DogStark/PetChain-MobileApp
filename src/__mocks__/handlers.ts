/**
 * MSW REST API Handlers
 *
 * Defines mock HTTP handlers for auth, pets, and appointments endpoints.
 * Used by the MSW server during tests to intercept real network calls and
 * return realistic fixture data.
 *
 * @see https://mswjs.io/docs/network-behavior/rest
 */

import { http, HttpResponse } from 'msw';

// ─── Base URL ─────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000/api';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export const MOCK_USER = {
  id: 'user-001',
  name: 'Jane Doe',
  email: 'jane@petchain.app',
  role: 'owner',
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const MOCK_TOKEN = 'mock.jwt.token';
export const MOCK_REFRESH_TOKEN = 'mock.refresh.token';

export const MOCK_PETS = [
  {
    id: 'pet-001',
    name: 'Buddy',
    species: 'dog',
    breed: 'Golden Retriever',
    dateOfBirth: '2020-03-15',
    weightKg: 28.5,
    microchipId: '985113000123456',
    photoUrl: 'https://petchain.app/photos/buddy.jpg',
    thumbnailUrl: 'https://petchain.app/photos/buddy_thumb.jpg',
    ownerId: 'user-001',
    createdAt: '2024-01-10T10:00:00.000Z',
    updatedAt: '2024-06-01T12:00:00.000Z',
  },
  {
    id: 'pet-002',
    name: 'Mittens',
    species: 'cat',
    breed: 'Siamese',
    dateOfBirth: '2021-07-22',
    weightKg: 4.2,
    ownerId: 'user-001',
    createdAt: '2024-02-05T10:00:00.000Z',
    updatedAt: '2024-06-01T12:00:00.000Z',
  },
];

export const MOCK_APPOINTMENTS = [
  {
    id: 'appt-001',
    petId: 'pet-001',
    vetId: 'vet-001',
    type: 'checkup',
    status: 'scheduled',
    scheduledAt: '2026-08-15T09:00:00.000Z',
    durationMins: 30,
    notes: 'Annual wellness checkup',
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
  },
  {
    id: 'appt-002',
    petId: 'pet-002',
    vetId: 'vet-001',
    type: 'vaccination',
    status: 'scheduled',
    scheduledAt: '2026-09-01T14:30:00.000Z',
    durationMins: 15,
    notes: 'Rabies booster',
    createdAt: '2024-06-10T00:00:00.000Z',
    updatedAt: '2024-06-10T00:00:00.000Z',
  },
];

// ─── Auth Handlers ────────────────────────────────────────────────────────────

const authHandlers = [
  // POST /api/auth/login
  http.post(`${BASE_URL}/auth/login`, async ({ request }) => {
    const body = await request.json() as { email?: string; password?: string };

    if (!body?.email || !body?.password) {
      return HttpResponse.json(
        { success: false, error: { message: 'Email and password are required' } },
        { status: 400 },
      );
    }

    if (body.email === 'invalid@example.com') {
      return HttpResponse.json(
        { success: false, error: { message: 'Invalid credentials' } },
        { status: 401 },
      );
    }

    return HttpResponse.json({
      success: true,
      token: MOCK_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      expiresIn: 3600,
      user: MOCK_USER,
    });
  }),

  // POST /api/auth/register
  http.post(`${BASE_URL}/auth/register`, async ({ request }) => {
    const body = await request.json() as { email?: string; password?: string; name?: string };

    if (!body?.email || !body?.password || !body?.name) {
      return HttpResponse.json(
        { success: false, error: { message: 'Missing registration fields' } },
        { status: 400 },
      );
    }

    return HttpResponse.json(
      {
        success: true,
        token: MOCK_TOKEN,
        refreshToken: MOCK_REFRESH_TOKEN,
        user: { ...MOCK_USER, email: body.email, name: body.name },
      },
      { status: 201 },
    );
  }),

  // POST /api/auth/refresh
  http.post(`${BASE_URL}/auth/refresh`, async ({ request }) => {
    const body = await request.json() as { refreshToken?: string };

    if (!body?.refreshToken || body.refreshToken === 'invalid-refresh-token') {
      return HttpResponse.json(
        { success: false, error: { message: 'Invalid or expired refresh token' } },
        { status: 401 },
      );
    }

    return HttpResponse.json({
      success: true,
      token: 'new.mock.jwt.token',
      refreshToken: 'new.mock.refresh.token',
    });
  }),

  // POST /api/auth/logout
  http.post(`${BASE_URL}/auth/logout`, () => {
    return HttpResponse.json({ success: true }, { status: 200 });
  }),
];

// ─── Pets Handlers ────────────────────────────────────────────────────────────

const petsHandlers = [
  // GET /api/pets
  http.get(`${BASE_URL}/pets`, () => {
    return HttpResponse.json({ success: true, data: MOCK_PETS });
  }),

  // GET /api/pets/:id
  http.get(`${BASE_URL}/pets/:id`, ({ params }) => {
    const pet = MOCK_PETS.find((p) => p.id === params.id);
    if (!pet) {
      return HttpResponse.json(
        { success: false, error: { message: 'Pet not found' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ success: true, data: pet });
  }),

  // POST /api/pets
  http.post(`${BASE_URL}/pets`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newPet = {
      id: `pet-${Date.now()}`,
      ...body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json({ success: true, data: newPet }, { status: 201 });
  }),

  // PUT /api/pets/:id
  http.put(`${BASE_URL}/pets/:id`, async ({ params, request }) => {
    const existing = MOCK_PETS.find((p) => p.id === params.id);
    if (!existing) {
      return HttpResponse.json(
        { success: false, error: { message: 'Pet not found' } },
        { status: 404 },
      );
    }
    const body = await request.json() as Record<string, unknown>;
    const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json({ success: true, data: updated });
  }),

  // DELETE /api/pets/:id
  http.delete(`${BASE_URL}/pets/:id`, ({ params }) => {
    const exists = MOCK_PETS.some((p) => p.id === params.id);
    if (!exists) {
      return HttpResponse.json(
        { success: false, error: { message: 'Pet not found' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ success: true }, { status: 200 });
  }),
];

// ─── Appointments Handlers ────────────────────────────────────────────────────

const appointmentsHandlers = [
  // GET /api/appointments
  http.get(`${BASE_URL}/appointments`, ({ request }) => {
    const url = new URL(request.url);
    const petId = url.searchParams.get('petId');
    const results = petId
      ? MOCK_APPOINTMENTS.filter((a) => a.petId === petId)
      : MOCK_APPOINTMENTS;
    return HttpResponse.json({ success: true, data: results });
  }),

  // GET /api/appointments/:id
  http.get(`${BASE_URL}/appointments/:id`, ({ params }) => {
    const appt = MOCK_APPOINTMENTS.find((a) => a.id === params.id);
    if (!appt) {
      return HttpResponse.json(
        { success: false, error: { message: 'Appointment not found' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ success: true, data: appt });
  }),

  // POST /api/appointments
  http.post(`${BASE_URL}/appointments`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newAppt = {
      id: `appt-${Date.now()}`,
      status: 'scheduled',
      ...body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json({ success: true, data: newAppt }, { status: 201 });
  }),

  // PATCH /api/appointments/:id
  http.patch(`${BASE_URL}/appointments/:id`, async ({ params, request }) => {
    const existing = MOCK_APPOINTMENTS.find((a) => a.id === params.id);
    if (!existing) {
      return HttpResponse.json(
        { success: false, error: { message: 'Appointment not found' } },
        { status: 404 },
      );
    }
    const body = await request.json() as Record<string, unknown>;
    const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json({ success: true, data: updated });
  }),

  // DELETE /api/appointments/:id
  http.delete(`${BASE_URL}/appointments/:id`, ({ params }) => {
    const exists = MOCK_APPOINTMENTS.some((a) => a.id === params.id);
    if (!exists) {
      return HttpResponse.json(
        { success: false, error: { message: 'Appointment not found' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ success: true }, { status: 200 });
  }),

  // GET /api/appointments/availability
  http.get(`${BASE_URL}/appointments/availability`, ({ request }) => {
    const url = new URL(request.url);
    const vetId = url.searchParams.get('vetId') ?? 'vet-001';
    const date = url.searchParams.get('date') ?? '2026-08-15';
    return HttpResponse.json({
      success: true,
      data: {
        vetId,
        date,
        availableSlots: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
      },
    });
  }),
];

// ─── All Handlers ─────────────────────────────────────────────────────────────

export const handlers = [...authHandlers, ...petsHandlers, ...appointmentsHandlers];
