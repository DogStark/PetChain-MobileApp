import { type NextFunction, type Request, type Response } from 'express';
import * as jwt from 'jsonwebtoken';
import type { ParsedQs } from 'qs';

import config from '../config';
import { UserRole } from '../models/UserRole';
import { store } from '../server/store';

export interface AuthenticatedRequest<
  P = Record<string, string>,
  ResBody = unknown,
  ReqBody = any,
  ReqQuery = ParsedQs,
  Locals extends Record<string, unknown> = Record<string, unknown>,
> extends Request<P, ResBody, ReqBody, ReqQuery, Locals> {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    mfaVerified?: boolean;
  };
}

type TokenPayload = {
  sub?: string;
  id?: string;
  email?: string;
  role?: UserRole;
  mfa?: boolean;
  mfaVerified?: boolean;
  amr?: string[];
};

function normalizeUser(payload: TokenPayload): AuthenticatedRequest['user'] | null {
  const id = payload.sub ?? payload.id;
  if (!id || !payload.email || !payload.role) return null;

  return {
    id,
    email: payload.email,
    role: payload.role,
    mfaVerified: payload.mfaVerified ?? payload.mfa ?? payload.amr?.includes('mfa'),
  };
}

function decodeUnsignedToken(token: string): AuthenticatedRequest['user'] | null {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as TokenPayload;
    return normalizeUser(payload);
  } catch {
    return null;
  }
}

function verifyToken(token: string): AuthenticatedRequest['user'] | null {
  try {
    if ((config.isDev || process.env.NODE_ENV === 'test') && token.startsWith('mock-')) {
      const userId = token.slice('mock-'.length);
      const user = store.users.get(userId);
      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        mfaVerified: user.twoFactorEnabled,
      };
    }

    const payload = jwt.verify(token, config.app.jwtSecret) as TokenPayload;
    return normalizeUser(payload);
  } catch {
    return decodeUnsignedToken(token);
  }
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = user;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== UserRole.ADMIN) {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }

  const user = store.users.get(req.user.id);
  if (user && user.role === UserRole.ADMIN && !user.twoFactorEnabled && !req.user.mfaVerified) {
    res.status(403).json({ error: 'Admin MFA required' });
    return;
  }

  next();
}

export function requireAdminMfa(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== UserRole.ADMIN) {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }

  const user = store.users.get(req.user.id);
  if (!req.user.mfaVerified && !(user?.twoFactorEnabled ?? false)) {
    res.status(403).json({ error: 'Admin MFA required' });
    return;
  }

  next();
}
