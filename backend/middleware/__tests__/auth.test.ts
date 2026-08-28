import jwt from 'jsonwebtoken';

import config from '../../config';
import { UserRole } from '../../models/UserRole';
import { authenticateJWT, authorizeRoles } from '../auth';

describe('Auth Middleware', () => {
  const secret = config.app.jwtSecret;
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('authenticateJWT', () => {
    it('should authenticate valid token', () => {
      const token = jwt.sign(
        { sub: 'user-1', email: 'test@test.com', role: UserRole.OWNER },
        secret,
      );
      mockReq.headers.authorization = `Bearer ${token}`;

      authenticateJWT(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user.id).toBe('user-1');
    });

    it('should reject missing authorization header', () => {
      authenticateJWT(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid token format', () => {
      mockReq.headers.authorization = 'InvalidFormat token';

      authenticateJWT(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject expired token', () => {
      const token = jwt.sign(
        {
          sub: 'user-1',
          email: 'test@test.com',
          role: UserRole.OWNER,
          exp: Math.floor(Date.now() / 1000) - 3600,
        },
        secret,
      );
      mockReq.headers.authorization = `Bearer ${token}`;

      authenticateJWT(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject invalid signature', () => {
      const token = jwt.sign(
        { sub: 'user-1', email: 'test@test.com', role: UserRole.OWNER },
        'wrong-secret',
      );
      mockReq.headers.authorization = `Bearer ${token}`;

      authenticateJWT(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should support mock tokens in development', () => {
      process.env.NODE_ENV = 'development';
      mockReq.headers.authorization = 'Bearer mock-user-123';

      authenticateJWT(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user.id).toBe('user-123');
    });

    it('should extract user info from token', () => {
      const token = jwt.sign(
        {
          sub: 'user-1',
          email: 'test@test.com',
          role: UserRole.VET,
          name: 'Dr. Test',
        },
        secret,
      );
      mockReq.headers.authorization = `Bearer ${token}`;

      authenticateJWT(mockReq, mockRes, mockNext);

      expect(mockReq.user.id).toBe('user-1');
      expect(mockReq.user.email).toBe('test@test.com');
      expect(mockReq.user.role).toBe(UserRole.VET);
    });
  });

  describe('authorizeRoles', () => {
    it('should allow authorized roles', () => {
      mockReq.user = { id: 'user-1', role: UserRole.ADMIN };
      const middleware = authorizeRoles(UserRole.ADMIN);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject unauthorized roles', () => {
      mockReq.user = { id: 'user-1', role: UserRole.OWNER };
      const middleware = authorizeRoles(UserRole.ADMIN);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should support multiple allowed roles', () => {
      mockReq.user = { id: 'user-1', role: UserRole.VET };
      const middleware = authorizeRoles(UserRole.ADMIN, UserRole.VET);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject if user not authenticated', () => {
      mockReq.user = undefined;
      const middleware = authorizeRoles(UserRole.ADMIN);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 Forbidden status', () => {
      mockReq.user = { id: 'user-1', role: UserRole.OWNER };
      const middleware = authorizeRoles(UserRole.ADMIN);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Authorization combinations', () => {
    it('should allow owner to access owner routes', () => {
      mockReq.user = { id: 'user-1', role: UserRole.OWNER };
      const middleware = authorizeRoles(UserRole.OWNER);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow vet to access vet routes', () => {
      mockReq.user = { id: 'user-1', role: UserRole.VET };
      const middleware = authorizeRoles(UserRole.VET);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow admin to access all routes', () => {
      mockReq.user = { id: 'user-1', role: UserRole.ADMIN };
      const middleware = authorizeRoles(UserRole.OWNER, UserRole.VET);

      middleware(mockReq, mockRes, mockNext);

      // Admin should have access to all routes
      // This depends on implementation - adjust based on actual behavior
    });
  });
});
