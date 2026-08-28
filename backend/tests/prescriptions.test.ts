import express from 'express';
import request from 'supertest';

import prescriptionsRouter from '../src/routes/prescriptions';

// Create a test app instance
const app = express();
app.use(express.json());
app.use('/api/prescriptions', prescriptionsRouter);

describe('Prescription Refill Workflow', () => {
  const prescriptionId = '1';

  /**
   * 1. GET all prescriptions
   */
  it('should fetch all prescriptions', async () => {
    const res = await request(app).get('/api/prescriptions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * 2. Request refill
   */
  it('should request a refill and set status to pending', async () => {
    const res = await request(app).post(`/api/prescriptions/${prescriptionId}/refill`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.message).toBe('Refill requested');
  });

  /**
   * 3. Approve refill
   */
  it('should approve a refill', async () => {
    const res = await request(app).post(`/api/prescriptions/${prescriptionId}/approve`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.message).toBe('Refill approved');
  });

  /**
   * 4. Deny refill (optional path test)
   */
  it('should deny a refill', async () => {
    const res = await request(app).post(`/api/prescriptions/${prescriptionId}/deny`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
    expect(res.body.message).toBe('Refill denied');
  });

  /**
   * 5. Mark ready for pickup
   */
  it('should mark prescription as ready for pickup', async () => {
    const res = await request(app).post(`/api/prescriptions/${prescriptionId}/ready`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready_for_pickup');
    expect(res.body.pharmacy).toBeDefined();
    expect(res.body.pharmacy.name).toBeDefined();
    expect(res.body.pharmacy.address).toBeDefined();
  });
});
