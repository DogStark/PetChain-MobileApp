import express from 'express';

import { ok, sendError } from '../response';
import { store } from '../store';

const router = express.Router();
const DEFAULT_TIMEOUT_MINUTES = 60;

function publicSession(session: NonNullable<ReturnType<typeof store.emergencySessions.get>>) {
  const latest = session.updates[session.updates.length - 1] ?? {
    latitude: session.latitude,
    longitude: session.longitude,
    accuracy: session.accuracy,
    recordedAt: session.createdAt,
  };
  return {
    id: session.id,
    message: session.message,
    latestLocation: latest,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    cancelledAt: session.cancelledAt,
    active: !session.cancelledAt && new Date(session.expiresAt).getTime() > Date.now(),
  };
}

router.post('/sessions', (req, res) => {
  const body = req.body as {
    userId?: string;
    message?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    timeoutMinutes?: number;
    contacts?: Array<{ name: string; phoneNumber: string; pushToken?: string }>;
  };
  if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'latitude and longitude are required');
  }
  const id = store.newId();
  const shareToken = store.newId();
  const createdAt = new Date().toISOString();
  const timeoutMinutes = Math.max(
    5,
    Math.min(body.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES, 24 * 60),
  );
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();
  const session = {
    id,
    userId: body.userId,
    message: body.message ?? 'PetChain emergency SOS',
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy: body.accuracy,
    shareToken,
    createdAt,
    expiresAt,
    contacts: body.contacts ?? [],
    updates: [
      {
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        recordedAt: createdAt,
      },
    ],
  };
  store.emergencySessions.set(shareToken, session);
  return res.status(201).json(
    ok({
      ...publicSession(session),
      shareToken,
      shareUrl: `https://petchain.app/emergency/${shareToken}`,
    }),
  );
});

router.post('/sessions/:shareToken/location', (req, res) => {
  const session = store.emergencySessions.get(req.params.shareToken);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Emergency session not found');
  if (session.cancelledAt)
    return sendError(res, 409, 'SESSION_CANCELLED', 'Emergency session is cancelled');
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return sendError(res, 410, 'SESSION_EXPIRED', 'Emergency session has expired');
  }
  const body = req.body as { latitude?: number; longitude?: number; accuracy?: number };
  if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'latitude and longitude are required');
  }
  session.latitude = body.latitude;
  session.longitude = body.longitude;
  session.accuracy = body.accuracy;
  session.updates.push({
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy: body.accuracy,
    recordedAt: new Date().toISOString(),
  });
  return res.json(ok(publicSession(session)));
});

router.post('/sessions/:shareToken/cancel', (req, res) => {
  const session = store.emergencySessions.get(req.params.shareToken);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Emergency session not found');
  session.cancelledAt = new Date().toISOString();
  return res.json(ok(publicSession(session), 'Emergency session cancelled'));
});

router.get('/sessions/:shareToken', (req, res) => {
  const session = store.emergencySessions.get(req.params.shareToken);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Emergency session not found');
  return res.json(ok(publicSession(session)));
});

router.get('/sessions/:shareToken/view', (req, res) => {
  const session = store.emergencySessions.get(req.params.shareToken);
  if (!session) return res.status(404).send('<h1>Emergency session not found</h1>');
  const view = publicSession(session);
  const { latitude, longitude } = view.latestLocation;
  return res
    .type('html')
    .send(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PetChain Emergency SOS</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#fff5f5;color:#1f2937"><main style="max-width:720px;margin:0 auto;padding:24px"><section style="background:white;border-radius:20px;padding:24px;box-shadow:0 12px 40px rgba(0,0,0,.08)"><h1>Emergency SOS</h1><p>${view.message}</p><p><strong>Status:</strong> ${view.active ? 'Active' : 'Inactive'}</p><p><strong>Last update:</strong> ${view.latestLocation.recordedAt}</p><p><a href="https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}">Open location in Google Maps</a></p><iframe title="location" width="100%" height="360" style="border:0;border-radius:16px" src="https://maps.google.com/maps?q=${latitude},${longitude}&z=15&output=embed"></iframe></section></main></body></html>`,
    );
});

export default router;
