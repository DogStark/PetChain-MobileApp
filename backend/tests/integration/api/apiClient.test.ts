import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// IMPORTANT: default import (fix for your earlier error)
import apiClient from '../../../services/apiClient';

/**
 * Mock server for real HTTP integration testing
 * (This simulates backend responses)
 */
const server = setupServer(
  http.get('*/pets', () => {
    return HttpResponse.json([
      { id: '1', name: 'Buddy' },
      { id: '2', name: 'Max' },
    ]);
  }),

  http.post('*/pets', async ({ request }) => {
    const body = await request.json();

    return HttpResponse.json({
      id: '3',
      ...(body as object),
    });
  }),

  http.get('*/error', () => {
    return new HttpResponse(null, { status: 500 });
  }),
);

beforeAll(() => {
  server.listen();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('API Client Integration Tests', () => {
  it('should fetch pets successfully (GET /pets)', async () => {
    const response = await apiClient.get('/pets');

    const data = response.data;

    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0].name).toBe('Buddy');
  });

  it('should create a new pet successfully (POST /pets)', async () => {
    const newPet = {
      name: 'Charlie',
      type: 'dog',
    };

    const response = await apiClient.post('/pets', newPet);

    const data = response.data;

    expect(data).toBeDefined();
    expect(data.name).toBe('Charlie');
    expect(data.id).toBe('3');
  });

  it('should handle API errors correctly', async () => {
    try {
      await apiClient.get('/error');
    } catch (err: any) {
      expect(err).toBeDefined();

      // Axios error structure safe check
      expect(err.response?.status || err.status).toBe(500);
    }
  });
});
