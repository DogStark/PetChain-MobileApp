/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';

import type { AuditableRequest } from '../../middleware/auditLog';
import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import referralService from '../../services/referralService';
import { userRepository, type DBUser } from '../../src/repositories/userRepository';
import { ok, sendError } from '../response';
import { store, type StoredUser } from '../store';

const router = express.Router();

function sanitize(u: DBUser) {
  const { password_hash: _p, ...rest } = u;
  return {
    ...rest,
    isEmailVerified: u.is_email_verified,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

function sanitizeStored(u: StoredUser) {
  const { passwordHash: _p, ...rest } = u;
  return rest;
}

router.get('/me', authenticateJWT, (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user!.id);
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  (req as AuditableRequest).audit?.('user.login', 'user', req.user!.id);
  return res.json(ok(sanitizeStored(user)));
});

router.get('/', authenticateJWT, authorizeRoles(UserRole.ADMIN), async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const role = q.role;
  const search = q.search?.toLowerCase();
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));

  let users = await userRepository.findAll();

  if (role) users = users.filter((u) => u.role === role);
  if (search) {
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(search) ||
        u.name.toLowerCase().includes(search) ||
        u.id.toLowerCase().includes(search),
    );
  }

  const total = users.length;
  const start = (page - 1) * limit;
  const slice = users.slice(start, start + limit).map(sanitize);
  const totalPages = Math.ceil(total / limit) || 1;

  return res.json({
    success: true,
    data: slice,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    timestamp: new Date().toISOString(),
  });
});

router.get('/:id', authenticateJWT, (req, res) => {
  const user = store.users.get(req.params.id);
  if (!user || user.deletedAt) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  return res.json(ok(sanitizeStored(user)));
});

router.post('/', async (req, res) => {
  const { email, name, phone, role, referralCode, deviceFingerprint } = req.body;
  if (!email?.trim() || !name?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'email and name are required');
  }

  const existing = await userRepository.findByEmail(email.trim().toLowerCase());
  if (existing) {
    return sendError(res, 409, 'CONFLICT', 'Email already registered');
  }

  const id = store.newId();
  const user = await userRepository.create({
    id,
    email: email.trim(),
    name: name.trim(),
    phone: phone?.trim(),
    role: (role as UserRole) || UserRole.OWNER,
    is_email_verified: false,
  });

  store.users.set(id, {
    id,
    email: email.trim(),
    name: name.trim(),
    phone: phone?.trim(),
    role: (role as UserRole) || UserRole.OWNER,
    pets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isEmailVerified: false,
    twoFactorEnabled: false,
  });

  referralService.ensureReferralCode(id);

  if (typeof referralCode === 'string' && referralCode.trim()) {
    try {
      referralService.createPendingReferral(referralCode, id, {
        deviceFingerprint: typeof deviceFingerprint === 'string' ? deviceFingerprint : undefined,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch {
      // Referral attribution should not block account creation.
    }
  }

  (req as AuditableRequest).audit?.('user.created', 'user', id, { email: email.trim() });
  return res.status(201).json(ok(sanitize(user), 'User created'));
});

router.put('/:id', authenticateJWT, (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.params.id);
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');

  // Only admin or the user themselves can update
  if (req.user!.role !== UserRole.ADMIN && req.user!.id !== req.params.id) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to update this user');
  }

  const { name, phone, role, isEmailVerified } = req.body as Partial<StoredUser>;
  const next: StoredUser = {
    ...user,
    ...(name !== undefined ? { name: String(name) } : {}),
    ...(phone !== undefined ? { phone: String(phone) } : {}),
    ...(role !== undefined && req.user!.role === UserRole.ADMIN ? { role: role as UserRole } : {}),
    ...(isEmailVerified !== undefined && req.user!.role === UserRole.ADMIN
      ? { isEmailVerified: Boolean(isEmailVerified) }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  store.users.set(user.id, next);
  (req as AuditableRequest).audit?.('user.updated', 'user', user.id);
  return res.json(ok(sanitizeStored(next), 'User updated'));
});

router.delete(
  '/:id',
  authenticateJWT,
  authorizeRoles(UserRole.ADMIN),
  (req: AuthenticatedRequest, res) => {
    const user = store.users.get(req.params.id);
    if (!user) {
      return sendError(res, 404, 'NOT_FOUND', 'User not found');
    }
    if (user.deletedAt) {
      return res.json(ok(null, 'User already archived'));
    }
    const archivedAt = new Date().toISOString();
    store.users.set(user.id, { ...user, deletedAt: archivedAt, updatedAt: archivedAt });
    (req as AuditableRequest).audit?.('user.deleted', 'user', req.params.id);
    return res.json(ok(null, 'User archived'));
  },
);

export default router;
