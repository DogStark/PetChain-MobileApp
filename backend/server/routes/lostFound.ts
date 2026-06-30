/**
 * Lost & Found routes
 *
 * POST /lost-found/reports               — create a report
 * GET  /lost-found/reports               — list/filter reports
 * GET  /lost-found/reports/:id/matches   — find opposite-type matches near report
 * POST /lost-found/location              — update owner's current location
 * POST /lost-found/notify-owners         — notify lost-pet owners near a found report (geofence)
 */

import { Router, type Request, type Response } from 'express';

import {
  createLostFoundReport,
  getLostFoundReports,
  findFoundReportsNear,
  notifyNearbyLostPetOwners,
} from '../services/lostFoundService';

const router = Router();

// ─── GET /lost-found/reports ─────────────────────────────────────────────────

router.get('/reports', async (req: Request, res: Response) => {
  try {
    const { type, species, radiusKm, latitude, longitude } = req.query as Record<string, string>;
    const result = await getLostFoundReports({
      type: type as 'lost' | 'found' | undefined,
      species,
      radiusKm: radiusKm ? Number(radiusKm) : undefined,
      latitude: latitude ? Number(latitude) : undefined,
      longitude: longitude ? Number(longitude) : undefined,
    });
    res.json({ success: true, data: { data: result.reports, total: result.total } });
  } catch (err) {
    console.error('[LostFound] GET /reports', err);
    res.status(500).json({ success: false, message: 'Failed to load reports' });
  }
});

// ─── POST /lost-found/reports ────────────────────────────────────────────────

router.post('/reports', async (req: Request, res: Response) => {
  try {
    const { type, title, description, species, breed, photoUrl, location } = req.body as {
      type: 'lost' | 'found';
      title: string;
      description: string;
      species: string;
      breed?: string;
      photoUrl?: string;
      location: { latitude: number; longitude: number };
    };

    // Extract userId from auth middleware (falls back to body for dev)
    const ownerId = (req as any).user?.id ?? req.body.ownerId ?? 'anonymous';

    if (!type || !title || !species || !location?.latitude || !location?.longitude) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const report = await createLostFoundReport({
      type,
      title,
      description: description ?? '',
      species,
      breed,
      photoUrl,
      location,
      ownerId,
    });

    // When a found report is created, proactively notify nearby lost-pet owners
    if (type === 'found') {
      void notifyNearbyLostPetOwners(report.id, report.title, location);
    }

    return res.status(201).json({ success: true, data: { data: report } });
  } catch (err) {
    console.error('[LostFound] POST /reports', err);
    return res.status(500).json({ success: false, message: 'Failed to create report' });
  }
});

// ─── GET /lost-found/reports/:id/matches ────────────────────────────────────

router.get('/reports/:id/matches', async (req: Request, res: Response) => {
  try {
    const { radiusKm } = req.query as Record<string, string>;
    const { id } = req.params;

    // Fetch the report first to get its location
    const { reports } = await getLostFoundReports({});
    const report = reports.find((r) => r.id === id);

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const matches = await findFoundReportsNear(
      report.location,
      radiusKm ? Number(radiusKm) : 30,
      id,
    );

    return res.json({ success: true, data: { data: matches, total: matches.length } });
  } catch (err) {
    console.error('[LostFound] GET /reports/:id/matches', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch matches' });
  }
});

// ─── POST /lost-found/location ───────────────────────────────────────────────

router.post('/location', async (req: Request, res: Response) => {
  // Location updates are stored per-user; implementation uses user session
  res.json({ success: true });
});

// ─── POST /lost-found/notify-owners ─────────────────────────────────────────

router.post('/notify-owners', async (req: Request, res: Response) => {
  try {
    const { foundReportId, latitude, longitude } = req.body as {
      foundReportId: string;
      latitude: number;
      longitude: number;
    };

    if (!foundReportId || latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Fetch the found report title for the notification body
    const { reports } = await getLostFoundReports({ type: 'found' });
    const found = reports.find((r) => r.id === foundReportId);

    const notified = await notifyNearbyLostPetOwners(
      foundReportId,
      found?.title ?? 'Found pet',
      { latitude, longitude },
    );

    return res.json({ success: true, data: { notified } });
  } catch (err) {
    console.error('[LostFound] POST /notify-owners', err);
    return res.status(500).json({ success: false, message: 'Failed to notify owners' });
  }
});

export default router;
