import request from 'supertest';
import express from 'express';
import medicationsRouter from '../medications';
import { UserRole } from '../../../models/UserRole';

const app = express();
app.use(express.json());

// Mock authentication middleware
jest.mock('../../../middleware/auth', () => ({
  authenticateJWT: (req: any, res: any, next: any) => {
    req.user = {
      id: req.headers['x-user-id'] || 'user123',
      role: req.headers['x-user-role'] || UserRole.OWNER,
    };
    next();
  },
  authorizeRoles: (...roles: any[]) => (req: any, res: any, next: any) => {
    if (roles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
  },
}));

// Mock audit logger
jest.mock('../../../middleware/auditLogger', () => ({
  logAuditTrail: jest.fn(),
}));

app.use('/api/medications', medicationsRouter);

describe('Dosage Approval Routes', () => {
  describe('POST /api/medications/dosage-approvals', () => {
    it('should create dosage approval request with valid data', async () => {
      const response = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .set('x-user-role', UserRole.OWNER)
        .send({
          petId: 'pet123',
          petName: 'Buddy',
          petWeight: 10.5,
          drugName: 'Carprofen',
          calculatedDose: '50',
          calculatedDoseUnit: 'mg',
          totalDoseMg: 50,
          safetyLevel: 'safe',
          vetId: 'vet456',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        petId: 'pet123',
        petName: 'Buddy',
        petWeight: 10.5,
        drugName: 'Carprofen',
        calculatedDose: '50',
        status: 'pending',
        vetId: 'vet456',
      });
      expect(response.body.data.id).toMatch(/^approval_/);
      expect(response.body.data.requestedAt).toBeDefined();
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .set('x-user-role', UserRole.OWNER)
        .send({
          petId: 'pet123',
          // missing petName, drugName, calculatedDose, vetId
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should generate unique IDs for each request', async () => {
      const payload = {
        petId: 'pet123',
        petName: 'Buddy',
        drugName: 'Carprofen',
        calculatedDose: '50',
        vetId: 'vet456',
      };

      const response1 = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .send(payload);

      const response2 = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .send(payload);

      expect(response1.body.data.id).not.toBe(response2.body.data.id);
    });

    it('should set default values for optional fields', async () => {
      const response = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .send({
          petId: 'pet123',
          petName: 'Buddy',
          drugName: 'Carprofen',
          calculatedDose: '50',
          vetId: 'vet456',
          // missing optional fields
        });

      expect(response.status).toBe(201);
      expect(response.body.data.petWeight).toBe(0);
      expect(response.body.data.calculatedDoseUnit).toBe('mg');
      expect(response.body.data.safetyLevel).toBe('unknown');
    });
  });

  describe('GET /api/medications/dosage-approvals/:id', () => {
    let approvalId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .send({
          petId: 'pet123',
          petName: 'Buddy',
          drugName: 'Carprofen',
          calculatedDose: '50',
          vetId: 'vet456',
        });
      approvalId = response.body.data.id;
    });

    it('should retrieve approval request by ID', async () => {
      const response = await request(app)
        .get(`/api/medications/dosage-approvals/${approvalId}`)
        .set('x-user-id', 'owner123')
        .set('x-user-role', UserRole.OWNER);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(approvalId);
      expect(response.body.data.status).toBe('pending');
    });

    it('should return 404 for non-existent approval request', async () => {
      const response = await request(app)
        .get('/api/medications/dosage-approvals/nonexistent')
        .set('x-user-id', 'owner123');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when owner tries to view another owners request', async () => {
      const response = await request(app)
        .get(`/api/medications/dosage-approvals/${approvalId}`)
        .set('x-user-id', 'differentOwner')
        .set('x-user-role', UserRole.OWNER);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow assigned vet to view request', async () => {
      const response = await request(app)
        .get(`/api/medications/dosage-approvals/${approvalId}`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET);

      expect(response.status).toBe(200);
      expect(response.body.data.vetId).toBe('vet456');
    });

    it('should return 403 when non-assigned vet tries to view request', async () => {
      const response = await request(app)
        .get(`/api/medications/dosage-approvals/${approvalId}`)
        .set('x-user-id', 'differentVet')
        .set('x-user-role', UserRole.VET);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/medications/dosage-approvals/:id/approve', () => {
    let approvalId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .send({
          petId: 'pet123',
          petName: 'Buddy',
          drugName: 'Carprofen',
          calculatedDose: '50',
          vetId: 'vet456',
        });
      approvalId = response.body.data.id;
    });

    it('should approve dosage without modifications', async () => {
      const response = await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/approve`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({
          vetNotes: 'Dosage is appropriate',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('approved');
      expect(response.body.data.vetNotes).toBe('Dosage is appropriate');
      expect(response.body.data.approvedAt).toBeDefined();
      expect(response.body.data.approvedDose).toBeUndefined();
    });

    it('should approve with dose modification', async () => {
      const response = await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/approve`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({
          approvedDose: '75',
          approvedDoseUnit: 'mg',
          vetNotes: 'Increased dose for better efficacy',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('modified');
      expect(response.body.data.approvedDose).toBe('75');
      expect(response.body.data.approvedDoseUnit).toBe('mg');
      expect(response.body.data.vetNotes).toBe('Increased dose for better efficacy');
    });

    it('should return 403 when owner tries to approve', async () => {
      const response = await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/approve`)
        .set('x-user-id', 'owner123')
        .set('x-user-role', UserRole.OWNER)
        .send({
          vetNotes: 'Looks good',
        });

      expect(response.status).toBe(403);
    });

    it('should return 404 for non-existent approval', async () => {
      const response = await request(app)
        .post('/api/medications/dosage-approvals/nonexistent/approve')
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({});

      expect(response.status).toBe(404);
    });

    it('should return 400 when trying to approve already processed request', async () => {
      // First approval
      await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/approve`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({});

      // Second approval attempt
      const response = await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/approve`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('POST /api/medications/dosage-approvals/:id/reject', () => {
    let approvalId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/medications/dosage-approvals')
        .set('x-user-id', 'owner123')
        .send({
          petId: 'pet123',
          petName: 'Buddy',
          drugName: 'Carprofen',
          calculatedDose: '50',
          vetId: 'vet456',
        });
      approvalId = response.body.data.id;
    });

    it('should reject dosage with reason', async () => {
      const response = await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/reject`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({
          vetNotes: 'Dose too high for pet weight',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('rejected');
      expect(response.body.data.vetNotes).toBe('Dose too high for pet weight');
      expect(response.body.data.approvedAt).toBeDefined();
    });

    it('should return 403 when owner tries to reject', async () => {
      const response = await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/reject`)
        .set('x-user-id', 'owner123')
        .set('x-user-role', UserRole.OWNER)
        .send({});

      expect(response.status).toBe(403);
    });

    it('should return 400 when trying to reject already processed request', async () => {
      // First rejection
      await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/reject`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({ vetNotes: 'Dose too high' });

      // Second rejection attempt
      const response = await request(app)
        .post(`/api/medications/dosage-approvals/${approvalId}/reject`)
        .set('x-user-id', 'vet456')
        .set('x-user-role', UserRole.VET)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });
  });
});
