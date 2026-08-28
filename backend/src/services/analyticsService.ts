/**
 * Analytics Service
 *
 * In-memory stores and computation engine for session monitoring data.
 * In production, replace the in-memory maps with database calls (e.g. PostgreSQL, InfluxDB).
 *
 * Responsibilities:
 * - Store session records and crash reports
 * - Calculate crash-free session rates per app version
 * - Identify top crash-prone user flows
 * - Correlate crashes with device models and OS versions
 * - Persist and retrieve crash-free rate alerts
 */

import { CRASH_FREE_THRESHOLD } from './sessionMonitoringTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredDeviceMetadata {
  model: string;
  os: string;
  osVersion: string;
  appVersion: string;
  platform: string;
}

export interface StoredSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: 'active' | 'crashed' | 'ended' | 'abnormal';
  device: StoredDeviceMetadata;
  appVersion: string;
  flowPath: string[];
  hasCrash: boolean;
  errorCount: number;
  durationMs?: number;
  recoveredFromInterruption?: boolean;
}

export interface StoredCrashReport {
  id: string;
  sessionId: string;
  error: string;
  stack?: string;
  timestamp: number;
  appVersion: string;
  device: StoredDeviceMetadata;
  activeFlow: string;
  flowPath: string[];
  recordedAt: number;
}

export interface StoredEvent {
  id: string;
  sessionId: string;
  type: string;
  flow: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface StoredAlert {
  id: string;
  type: string;
  appVersion: string;
  currentRate: number;
  threshold: number;
  timestamp: string;
  recordedAt: number;
}

export interface CrashFreeStats {
  appVersion: string;
  totalSessions: number;
  crashedSessions: number;
  crashFreeRate: number;
  isBelowThreshold: boolean;
  topCrashFlows: Array<{ flow: string; crashCount: number; percentage: number }>;
  byDevice: Array<{ model: string; crashCount: number; crashFreeRate: number }>;
  byOsVersion: Array<{ os: string; osVersion: string; crashCount: number; crashFreeRate: number }>;
  calculatedAt: string;
}

export interface FlowCrashStat {
  flow: string;
  crashCount: number;
  percentage: number;
}

export interface DeviceBreakdown {
  byDevice: Array<{
    model: string;
    crashCount: number;
    totalSessions: number;
    crashFreeRate: number;
  }>;
  byOsVersion: Array<{
    os: string;
    osVersion: string;
    crashCount: number;
    totalSessions: number;
    crashFreeRate: number;
  }>;
}

// ─── Session Store ────────────────────────────────────────────────────────────

class SessionStore {
  private sessions = new Map<string, StoredSession>();

  async create(session: StoredSession): Promise<StoredSession> {
    this.sessions.set(session.id, { ...session });
    return session;
  }

  async update(id: string, updates: Partial<StoredSession>): Promise<StoredSession> {
    const existing = this.sessions.get(id);
    if (!existing) {
      // Create a minimal record if session wasn't tracked (e.g. crash before session start)
      const minimal: StoredSession = {
        id,
        startedAt: Date.now(),
        status: 'active',
        device: {
          model: 'unknown',
          os: 'unknown',
          osVersion: 'unknown',
          appVersion: 'unknown',
          platform: 'unknown',
        },
        appVersion: 'unknown',
        flowPath: [],
        hasCrash: false,
        errorCount: 0,
        ...updates,
      };
      this.sessions.set(id, minimal);
      return minimal;
    }

    const updated = { ...existing, ...updates };
    this.sessions.set(id, updated);
    return updated;
  }

  async get(id: string): Promise<StoredSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async addEvent(event: StoredEvent): Promise<void> {
    // Events are stored separately in the event store; this is a no-op hook
    // for future session-level event aggregation
  }

  /** Return all sessions, optionally filtered by appVersion */
  getAll(appVersion?: string): StoredSession[] {
    const all = Array.from(this.sessions.values());
    if (!appVersion) return all;
    return all.filter((s) => s.appVersion === appVersion);
  }

  /** Return only completed (non-active) sessions */
  getCompleted(appVersion?: string): StoredSession[] {
    return this.getAll(appVersion).filter((s) => s.status !== 'active');
  }
}

// ─── Crash Store ──────────────────────────────────────────────────────────────

class CrashStore {
  private crashes = new Map<string, StoredCrashReport>();
  private idCounter = 0;

  async create(report: Omit<StoredCrashReport, 'id'>): Promise<StoredCrashReport> {
    const id = `crash-${Date.now()}-${++this.idCounter}`;
    const stored: StoredCrashReport = { id, ...report };
    this.crashes.set(id, stored);
    return stored;
  }

  getAll(appVersion?: string): StoredCrashReport[] {
    const all = Array.from(this.crashes.values());
    if (!appVersion) return all;
    return all.filter((c) => c.appVersion === appVersion);
  }
}

// ─── Event Store ──────────────────────────────────────────────────────────────

class EventStore {
  private events: StoredEvent[] = [];
  private readonly maxEvents = 10_000;

  async add(event: StoredEvent): Promise<void> {
    this.events.push(event);
    // Trim oldest events when buffer is full
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  getBySession(sessionId: string): StoredEvent[] {
    return this.events.filter((e) => e.sessionId === sessionId);
  }
}

// ─── Alert Service ────────────────────────────────────────────────────────────

class AlertService {
  private alerts: StoredAlert[] = [];
  private idCounter = 0;

  async record(alert: Omit<StoredAlert, 'id' | 'recordedAt'>): Promise<StoredAlert> {
    const stored: StoredAlert = {
      id: `alert-${Date.now()}-${++this.idCounter}`,
      ...alert,
      recordedAt: Date.now(),
    };
    this.alerts.push(stored);
    return stored;
  }

  async list(appVersion?: string, limit = 20): Promise<StoredAlert[]> {
    let results = [...this.alerts].reverse(); // newest first
    if (appVersion) {
      results = results.filter((a) => a.appVersion === appVersion);
    }
    return results.slice(0, limit);
  }
}

// ─── Analytics Engine ─────────────────────────────────────────────────────────

class AnalyticsEngine {
  constructor(
    private readonly sessions: SessionStore,
    private readonly crashes: CrashStore,
  ) {}

  /**
   * Calculate crash-free session rate for a given app version.
   * crash-free rate = (total - crashed) / total * 100
   */
  async getCrashFreeStats(appVersion?: string): Promise<CrashFreeStats> {
    const completed = this.sessions.getCompleted(appVersion);
    const totalSessions = completed.length;

    const crashedSessions = completed.filter((s) => s.status === 'crashed' || s.hasCrash).length;

    const crashFreeRate =
      totalSessions === 0 ? 100 : ((totalSessions - crashedSessions) / totalSessions) * 100;

    const topCrashFlows = await this.getTopCrashFlows(appVersion, 5);
    const breakdown = await this.getDeviceBreakdown(appVersion);

    return {
      appVersion: appVersion ?? 'all',
      totalSessions,
      crashedSessions,
      crashFreeRate: Math.round(crashFreeRate * 100) / 100,
      isBelowThreshold: crashFreeRate < CRASH_FREE_THRESHOLD,
      topCrashFlows,
      byDevice: breakdown.byDevice.map((d) => ({
        model: d.model,
        crashCount: d.crashCount,
        crashFreeRate: d.crashFreeRate,
      })),
      byOsVersion: breakdown.byOsVersion.map((o) => ({
        os: o.os,
        osVersion: o.osVersion,
        crashCount: o.crashCount,
        crashFreeRate: o.crashFreeRate,
      })),
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Identify the top N crash-prone user flows.
   * A flow is "crash-prone" if crashes occurred while it was the active flow.
   */
  async getTopCrashFlows(appVersion?: string, limit = 5): Promise<FlowCrashStat[]> {
    const crashReports = this.crashes.getAll(appVersion);
    const totalCrashes = crashReports.length;

    if (totalCrashes === 0) return [];

    // Count crashes per active flow
    const flowCounts = new Map<string, number>();
    for (const report of crashReports) {
      const flow = report.activeFlow ?? 'unknown';
      flowCounts.set(flow, (flowCounts.get(flow) ?? 0) + 1);
    }

    // Sort by crash count descending and take top N
    const sorted = Array.from(flowCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([flow, crashCount]) => ({
      flow,
      crashCount,
      percentage: Math.round((crashCount / totalCrashes) * 10000) / 100,
    }));
  }

  /**
   * Correlate crashes with device models and OS versions.
   */
  async getDeviceBreakdown(appVersion?: string): Promise<DeviceBreakdown> {
    const completed = this.sessions.getCompleted(appVersion);

    // ── By device model ──────────────────────────────────────────────────────
    const deviceMap = new Map<string, { total: number; crashed: number }>();
    for (const session of completed) {
      const key = session.device.model || 'unknown';
      const entry = deviceMap.get(key) ?? { total: 0, crashed: 0 };
      entry.total += 1;
      if (session.hasCrash || session.status === 'crashed') entry.crashed += 1;
      deviceMap.set(key, entry);
    }

    const byDevice = Array.from(deviceMap.entries())
      .map(([model, { total, crashed }]) => ({
        model,
        crashCount: crashed,
        totalSessions: total,
        crashFreeRate: total === 0 ? 100 : Math.round(((total - crashed) / total) * 10000) / 100,
      }))
      .sort((a, b) => b.crashCount - a.crashCount);

    // ── By OS version ────────────────────────────────────────────────────────
    const osMap = new Map<string, { total: number; crashed: number; os: string }>();
    for (const session of completed) {
      const key = `${session.device.os}::${session.device.osVersion}`;
      const entry = osMap.get(key) ?? { total: 0, crashed: 0, os: session.device.os };
      entry.total += 1;
      if (session.hasCrash || session.status === 'crashed') entry.crashed += 1;
      osMap.set(key, entry);
    }

    const byOsVersion = Array.from(osMap.entries())
      .map(([key, { total, crashed, os }]) => {
        const [, osVersion] = key.split('::');
        return {
          os,
          osVersion: osVersion ?? 'unknown',
          crashCount: crashed,
          totalSessions: total,
          crashFreeRate: total === 0 ? 100 : Math.round(((total - crashed) / total) * 10000) / 100,
        };
      })
      .sort((a, b) => b.crashCount - a.crashCount);

    return { byDevice, byOsVersion };
  }
}

// ─── Singleton exports ────────────────────────────────────────────────────────

export const sessionStore = new SessionStore();
export const crashStore = new CrashStore();
export const eventStore = new EventStore();
export const alertService = new AlertService();
export const analyticsEngine = new AnalyticsEngine(sessionStore, crashStore);
