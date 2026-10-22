import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// ✅ Correct imports (MATCHES YOUR REAL SERVICE)
import {
  getAllPets,
  getPetById,
  createPet,
  updatePet,
  deletePet,
  getPetByQRCode,
} from '../../../services/petService';

/**
 * Mock server for integration testing
 */
const server = setupServer(
  http.get('*/pets', () => {
    return HttpResponse.json([
      {
        id: '1',
        name: 'Buddy',
        species: 'dog',
        ownerId: 'user1',
        qrCode: 'QR123',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
      {
        id: '2',
        name: 'Milo',
        species: 'cat',
        ownerId: 'user1',
        qrCode: 'QR456',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
    ]);
  }),

  http.get('*/pets/1', () => {
    return HttpResponse.json({
      id: '1',
      name: 'Buddy',
      species: 'dog',
      ownerId: 'user1',
      qrCode: 'QR123',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });
  }),

  http.post('*/pets', async ({ request }) => {
    const body = (await request.json()) as any;

    return HttpResponse.json({
      id: '3',
      qrCode: 'QR999',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      ...body,
    });
  }),

  http.put('*/pets/1', async ({ request }) => {
    const body = (await request.json()) as any;

    return HttpResponse.json({
      id: '1',
      qrCode: 'QR123',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
      ...body,
    });
  }),

  http.delete('*/pets/1', () => {
    return new HttpResponse(null, { status: 200 });
  }),

  http.get('*/pets/qr/QR123', () => {
    return HttpResponse.json({
      id: '1',
      name: 'Buddy',
      species: 'dog',
      ownerId: 'user1',
      qrCode: 'QR123',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Pet Service Integration Tests', () => {
  it('should get all pets', async () => {
    const response = await getAllPets();

    expect(response.success).toBe(true);
    expect(response.data?.length).toBe(2);
    expect(response.data?.[0].name).toBe('Buddy');
  });

  it('should get pet by id', async () => {
    const response = await getPetById('1');

    expect(response.success).toBe(true);
    expect(response.data?.id).toBe('1');
  });

  it('should create a pet (valid CreatePetInput)', async () => {
    const response = await createPet({
      name: 'Charlie',
      species: 'dog',
      ownerId: 'user1',
    });

    expect(response.success).toBe(true);
    expect(response.data?.name).toBe('Charlie');
  });

  it('should update a pet', async () => {
    const response = await updatePet('1', {
      name: 'Updated Buddy',
    });

    expect(response.success).toBe(true);
    expect(response.data?.name).toBe('Updated Buddy');
  });

  it('should delete a pet', async () => {
    const response = await deletePet('1');

    expect(response.success).toBe(true);
  });

  it('should get pet by QR code', async () => {
    const response = await getPetByQRCode('QR123');

    expect(response.success).toBe(true);
    expect(response.data?.qrCode).toBe('QR123');
  });
});
