const request = require('supertest');

const { createApp } = require('../server/app');

const app = createApp();

describe('Health Thresholds API', () => {
  /**
   * NOTE:
   * These tests assume the /api/thresholds route is registered
   * and database layer is properly wired in the backend.
   */

  describe('PUT /thresholds/:petId', () => {
    test('rejects unsafe temperature range', async () => {
      const res = await request(app).put('/api/thresholds/1').send({
        weight_min: 2,
        weight_max: 10,
        temperature_min: 10, // unsafe
        temperature_max: 80, // unsafe
        heart_rate_min: 60,
        heart_rate_max: 180,
        activity_min: 1,
        activity_max: 10,
      });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('updates thresholds successfully', async () => {
      const res = await request(app).put('/api/thresholds/1').send({
        weight_min: 2,
        weight_max: 10,
        temperature_min: 35,
        temperature_max: 39,
        heart_rate_min: 60,
        heart_rate_max: 180,
        activity_min: 1,
        activity_max: 10,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('GET /thresholds/:petId', () => {
    test('returns threshold data (or null if not set)', async () => {
      const res = await request(app).get('/api/thresholds/1');

      expect(res.status).toBe(200);
      expect(res.body === null || typeof res.body === 'object').toBe(true);
    });
  });
});
