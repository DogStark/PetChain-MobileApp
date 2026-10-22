import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';

import config from '../../config';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import referralService from '../../services/referralService';
import {
  generateBackupCodes,
  generateQRCodeDataURL,
  generateRecoveryToken,
  generateSecret,
  verifyBackupCode,
  verifyRecoveryToken,
  verifyTOTP,
} from '../../services/totpService';
import { ok, sendError } from '../response';
import { store } from '../store';

const router = express.Router();

function authUser(user: { id: string; email: string; name: string; role: UserRole }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

function issueToken(user: { id: string; email: string; role: UserRole }) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.app.jwtSecret, {
    expiresIn: '1h',
  });
}

router.post('/register', async (req, res) => {
  const { email, name, password, phone, role, referralCode, deviceFingerprint } = req.body as {
    email?: string;
    name?: string;
    password?: string;
    phone?: string;
    role?: UserRole;
    referralCode?: string;
    deviceFingerprint?: string;
  };

  if (!email?.trim() || !name?.trim() || !password) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'email, name, and password are required');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = [...store.users.values()].find(
    (user) => user.email.trim().toLowerCase() === normalizedEmail,
  );
  if (existing) {
    return sendError(res, 409, 'CONFLICT', 'Email already registered');
  }

  const t = new Date().toISOString();
  const user = {
    id: store.newId(),
    email: normalizedEmail,
    name: name.trim(),
    phone: phone?.trim(),
    role: role || UserRole.OWNER,
    pets: [],
    createdAt: t,
    updatedAt: t,
    isEmailVerified: false,
    passwordHash: await bcrypt.hash(password, 10),
    twoFactorEnabled: false,
  };

  store.users.set(user.id, user);
  referralService.ensureReferralCode(user.id);

  if (referralCode?.trim()) {
    try {
      referralService.createPendingReferral(referralCode, user.id, {
        deviceFingerprint,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch {
      // Referral attribution should not prevent account creation.
    }
  }

  return res.status(201).json({
    user: authUser(user),
    token: issueToken(user),
    expiresIn: 3600,
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email?.trim() || !password) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'email and password are required');
  }

  const user = [...store.users.values()].find(
    (row) => row.email.trim().toLowerCase() === email.trim().toLowerCase(),
  );
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Invalid credentials');
  }

  store.users.set(user.id, { ...user, lastLoginAt: new Date().toISOString() });

  return res.json({
    user: authUser(user),
    token: issueToken(user),
    expiresIn: 3600,
  });
});

// ── POST /api/auth/2fa/setup ───────────────────────────────────────────────
// Generates a new TOTP secret and QR code for the authenticated user.
// The secret is stored as "pending" until confirmed via /verify-setup.
router.post('/2fa/setup', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user?.id ?? '');
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  if (user.twoFactorEnabled) {
    return sendError(res, 409, 'CONFLICT', '2FA is already enabled');
  }

  const secret = generateSecret();
  const qrCode = await generateQRCodeDataURL(secret, user.email);

  store.users.set(user.id, {
    ...user,
    twoFactorPendingSecret: secret,
    updatedAt: new Date().toISOString(),
  });

  // Never expose the raw secret in logs — only return it once for authenticator app entry
  return res.json(
    ok(
      { qrCode, secret },
      'Scan the QR code with your authenticator app, then confirm with /2fa/verify-setup',
    ),
  );
});

// ── POST /api/auth/2fa/verify-setup ───────────────────────────────────────
// Confirms setup by verifying the first TOTP code. Activates 2FA and returns backup codes.
router.post('/2fa/verify-setup', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user?.id ?? '');
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  if (!user.twoFactorPendingSecret) {
    return sendError(res, 400, 'BAD_REQUEST', 'No pending 2FA setup. Call /2fa/setup first');
  }

  const { token } = req.body as { token?: string };
  if (!token) return sendError(res, 400, 'VALIDATION_ERROR', 'token is required');

  if (!verifyTOTP(token, user.twoFactorPendingSecret)) {
    return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired TOTP code');
  }

  const { plain, hashed } = await generateBackupCodes();

  store.users.set(user.id, {
    ...user,
    twoFactorEnabled: true,
    twoFactorSecret: user.twoFactorPendingSecret,
    twoFactorPendingSecret: undefined,
    twoFactorBackupCodes: hashed,
    updatedAt: new Date().toISOString(),
  });

  return res.json(
    ok(
      { backupCodes: plain },
      'Two-factor authentication enabled. Store these backup codes safely — they will not be shown again',
    ),
  );
});

// ── POST /api/auth/2fa/verify ─────────────────────────────────────────────
// Verifies a TOTP code during login (called after password check).
router.post('/2fa/verify', authenticateJWT, (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user?.id ?? '');
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return sendError(res, 400, 'BAD_REQUEST', '2FA is not enabled for this account');
  }

  // Enforce 2FA for admins
  if (user.role === UserRole.ADMIN && !user.twoFactorEnabled) {
    return sendError(res, 403, 'FORBIDDEN', 'Admin accounts must have 2FA enabled');
  }

  const { token } = req.body as { token?: string };
  if (!token) return sendError(res, 400, 'VALIDATION_ERROR', 'token is required');

  if (!verifyTOTP(token, user.twoFactorSecret)) {
    return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired TOTP code');
  }

  store.users.set(user.id, { ...user, lastLoginAt: new Date().toISOString() });
  return res.json(ok({ verified: true }, '2FA verification successful'));
});

// ── POST /api/auth/2fa/disable ────────────────────────────────────────────
// Disables 2FA after verifying a valid TOTP code. Admins cannot disable 2FA.
router.post('/2fa/disable', authenticateJWT, (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user?.id ?? '');
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  if (!user.twoFactorEnabled) {
    return sendError(res, 400, 'BAD_REQUEST', '2FA is not enabled');
  }
  if (user.role === UserRole.ADMIN) {
    return sendError(res, 403, 'FORBIDDEN', 'Admin accounts cannot disable 2FA');
  }

  const { token } = req.body as { token?: string };
  if (!token) return sendError(res, 400, 'VALIDATION_ERROR', 'token is required');

  if (!verifyTOTP(token, user.twoFactorSecret!)) {
    return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired TOTP code');
  }

  store.users.set(user.id, {
    ...user,
    twoFactorEnabled: false,
    twoFactorSecret: undefined,
    twoFactorBackupCodes: undefined,
    twoFactorPendingSecret: undefined,
    updatedAt: new Date().toISOString(),
  });

  return res.json(ok(null, 'Two-factor authentication disabled'));
});

// ── POST /api/auth/2fa/backup-verify ─────────────────────────────────────
// Verifies a single-use backup code (consumed on success).
router.post('/2fa/backup-verify', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user?.id ?? '');
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  if (!user.twoFactorEnabled || !user.twoFactorBackupCodes?.length) {
    return sendError(res, 400, 'BAD_REQUEST', '2FA is not enabled or no backup codes remain');
  }

  const { code } = req.body as { code?: string };
  if (!code) return sendError(res, 400, 'VALIDATION_ERROR', 'code is required');

  const idx = await verifyBackupCode(code, user.twoFactorBackupCodes);
  if (idx === -1) {
    return sendError(res, 401, 'INVALID_CODE', 'Invalid backup code');
  }

  // Remove the used code (single-use)
  const remaining = user.twoFactorBackupCodes.filter((_, i) => i !== idx);
  store.users.set(user.id, {
    ...user,
    twoFactorBackupCodes: remaining,
    updatedAt: new Date().toISOString(),
  });

  return res.json(ok({ codesRemaining: remaining.length }, 'Backup code accepted'));
});

// ── POST /api/auth/2fa/backup-regenerate ─────────────────────────────────
// Regenerates all backup codes after verifying a valid TOTP code.
router.post('/2fa/backup-regenerate', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user?.id ?? '');
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return sendError(res, 400, 'BAD_REQUEST', '2FA is not enabled');
  }

  const { token } = req.body as { token?: string };
  if (!token) return sendError(res, 400, 'VALIDATION_ERROR', 'token is required');

  if (!verifyTOTP(token, user.twoFactorSecret)) {
    return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired TOTP code');
  }

  const { plain, hashed } = await generateBackupCodes();
  store.users.set(user.id, {
    ...user,
    twoFactorBackupCodes: hashed,
    updatedAt: new Date().toISOString(),
  });

  return res.json(ok({ backupCodes: plain }, 'Backup codes regenerated. Store them safely'));
});

// ── POST /api/auth/2fa/recovery/request ──────────────────────────────────
// Issues a recovery token (simulates email delivery — token returned for demo).
router.post('/2fa/recovery/request', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return sendError(res, 400, 'VALIDATION_ERROR', 'email is required');

  const user = [...store.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
  // Always respond 200 to prevent user enumeration
  if (!user || !user.twoFactorEnabled) {
    return res.json(
      ok(null, 'If that account exists and has 2FA enabled, a recovery email has been sent'),
    );
  }

  const { token, hashedToken, expiresAt } = await generateRecoveryToken();
  store.users.set(user.id, {
    ...user,
    recoveryToken: hashedToken,
    recoveryTokenExpiresAt: expiresAt,
    updatedAt: new Date().toISOString(),
  });

  // In production this token would be emailed. Returned here for testability.
  return res.json(
    ok({ recoveryToken: token, expiresAt }, 'Recovery token issued (send via email in production)'),
  );
});

// ── POST /api/auth/2fa/recovery/verify ───────────────────────────────────
// Verifies the recovery token and disables 2FA (token is invalidated after use).
router.post('/2fa/recovery/verify', async (req, res) => {
  const { email, token } = req.body as { email?: string; token?: string };
  if (!email || !token) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'email and token are required');
  }

  const user = [...store.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !user.recoveryToken || !user.recoveryTokenExpiresAt) {
    return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired recovery token');
  }

  const valid = await verifyRecoveryToken(token, user.recoveryToken, user.recoveryTokenExpiresAt);
  if (!valid) {
    return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired recovery token');
  }

  // Disable 2FA and invalidate token
  store.users.set(user.id, {
    ...user,
    twoFactorEnabled: false,
    twoFactorSecret: undefined,
    twoFactorBackupCodes: undefined,
    twoFactorPendingSecret: undefined,
    recoveryToken: undefined,
    recoveryTokenExpiresAt: undefined,
    updatedAt: new Date().toISOString(),
  });

  return res.json(
    ok(null, '2FA has been disabled via account recovery. Please re-enable it after logging in'),
  );
});

export default router;
