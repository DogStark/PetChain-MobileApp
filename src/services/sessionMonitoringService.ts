/**
 * Session Monitoring Service
 *
 * Tracks session lifecycle events, crash occurrences, and user flows.
 * Integrates with Sentry session tracking APIs for crash-free rate calculation.
 * Alerts when crash-free rate drops below 99.5%.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import apiClient from './apiClient';
import config from '../config';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  CURRENT_SESSION: '@session_monitoring:current_session',
  PENDING_EVENTS: '@session_monitoring:pending_events',
  CRASH_HISTORY: '@session_monitoring:crash_history',
} as const;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Crash-free rate threshold — alert fires when rate drops below this */
export const CRASH_FREE_THRESHOLD = 99.5;

/** Maximum events to buffer locally before flushing */
const MAX_PENDING_EVENTS = 100;

/** Session timeout in ms — sessions idle longer than this are auto-ended */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'crashed' | 'ended' | 'abnormal';

export type UserFlowStep =
  | 'app_launch'
  | 'login'
  | 'register'
  | 'pet_list'
  | 'pet_detail'
  | 'pet_create'
  | 'pet_edit'
  | 'medical_record_view'
  | 'medical_record_create'
  | 'appointment_view'
  | 'appointment_create'
  | 'medication_view'
  | 'medication_create'
  | 'qr_scan'
  | 'blockchain_verify'
  | 'profile_view'
  | 'emergency_contacts'
  | 'onboarding'
  | string;

export type SessionEventType =
  | 'session_start'
  | 'session_end'
  | 'navigation'
  | 'error'
  | 'crash'
  | 'user_action'
  | 'network_error'
  | 'api_error';

export interface DeviceMetadata {
  /** Device model identifier, e.g. "iPhone 14 Pro", "Pixel 7" */
  model: string;
  /** OS name, e.g. "iOS", "Android" */
  os: string;
  /** OS version string, e.g. "17.2", "14" */
  osVersion: string;
  /** App version from config */
  appVersion: string;
  /** Platform: "ios" | "android" | "web" */
  platform: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  /** The user flow step this event belongs to */
  flow: UserFlowStep;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface Session {
  id: string;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  /** Duration in ms — set when session ends */
  durationMs?: number;
  device: DeviceMetadata;
  appVersion: string;
  /** Ordered list of flow steps visited during this session */
  flowPath: UserFlowStep[];
  /** Whether a crash occurred during this session */
  hasCrash: boolean;
  /** Number of errors (non-fatal) during this session */
  errorCount: number;
}

export interface CrashReport {
  sessionId: string;
  error: string;
  stack?: string;
  timestamp: number;
  appVersion: string;
  device: DeviceMetadata;
  /** The flow step active when the crash occurred */
  activeFlow: UserFlowStep;
  /** Full flow path leading up to the crash */
  flowPath: UserFlowStep[];
}

export interface CrashFreeStats {
  appVersion: string;
  totalSessions: number;
  crashedSessions: number;
  crashFreeRate: number;
  isBelowThreshold: boolean;
  /** Top 5 crash-prone user flows with crash counts */
  topCrashFlows: Array<{ flow: UserFlowStep; crashCount: number; percentage: number }>;
  /** Crash breakdown by device model */
  byDevice: Array<{ model: string; crashCount: number; crashFreeRate: number }>;
  /** Crash breakdown by OS version */
  byOsVersion: Array<{ os: string; osVersion: string; crashCount: number; crashFreeRate: number }>;
  calculatedAt: string;
}

export interface AlertPayload {
  type: 'crash_free_rate_below_threshold';
  appVersion: string;
  currentRate: number;
  threshold: number;
  timestamp: string;
}

// ─── Timeout warning configuration ───────────────────────────────────────────

/** How many ms before session expiry to show the warning modal */
const WARNING_BEFORE_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

export interface SessionTimeoutWarningPayload {
  /** Seconds remaining until auto-logout */
  secondsRemaining: number;
}

type TimeoutWarningListener = (payload: SessionTimeoutWarningPayload) => void;
type TimeoutExpiredListener = () => void;

// ─── Error Class ──────────────────────────────────────────────────────────────

export class SessionMonitoringError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'SessionMonitoringError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Service ──────────────────────────────────────────────────────────────────

class SessionMonitoringService {
  private currentSession: Session | null = null;
  private activeFlow: UserFlowStep = 'app_launch';
  private statusListeners: Array<(status: SessionStatus) => void> = [];
  private alertListeners: Array<(alert: AlertPayload) => void> = [];

  // ── Inactivity / timeout warning ──────────────────────────────────────────
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private warningCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private timeoutWarningListeners: TimeoutWarningListener[] = [];
  private timeoutExpiredListeners: TimeoutExpiredListener[] = [];
  private warningActive = false;

  // ── Session lifecycle ──────────────────────────────────────────────────────

  /**
   * Start a new monitoring session. Ends any previously active session first.
   * Sends a Sentry-compatible session_start event to the backend.
   */
  async startSession(device: DeviceMetadata): Promise<string> {
    // End any lingering session before starting a new one
    if (this.currentSession && this.currentSession.status === 'active') {
      await this.endSession('abnormal');
    }

    const session: Session = {
      id: generateId(),
      status: 'active',
      startedAt: Date.now(),
      device,
      appVersion: device.appVersion,
      flowPath: ['app_launch'],
      hasCrash: false,
      errorCount: 0,
    };

    this.currentSession = session;
    this.activeFlow = 'app_launch';

    await this._persistCurrentSession();

    await this._trackEvent({
      type: 'session_start',
      flow: 'app_launch',
      data: {
        device,
        appVersion: device.appVersion,
        sentrySessionStatus: 'ok',
      },
    });

    await this._sendToBackend('/monitoring/sessions/start', {
      sessionId: session.id,
      startedAt: new Date(session.startedAt).toISOString(),
      device,
      appVersion: device.appVersion,
    });

    this._resetInactivityTimer();

    return session.id;
  }

  /**
   * End the current session normally.
   */
  async endSession(status: Extract<SessionStatus, 'ended' | 'abnormal'> = 'ended'): Promise<void> {
    this._clearTimers();
    if (!this.currentSession) return;

    const now = Date.now();
    this.currentSession.status = status;
    this.currentSession.endedAt = now;
    this.currentSession.durationMs = now - this.currentSession.startedAt;

    await this._trackEvent({
      type: 'session_end',
      flow: this.activeFlow,
      data: {
        status,
        durationMs: this.currentSession.durationMs,
        errorCount: this.currentSession.errorCount,
        flowPath: this.currentSession.flowPath,
        sentrySessionStatus: status === 'ended' ? 'exited' : 'abnormal',
      },
    });

    await this._sendToBackend('/monitoring/sessions/end', {
      sessionId: this.currentSession.id,
      endedAt: new Date(now).toISOString(),
      status,
      durationMs: this.currentSession.durationMs,
      flowPath: this.currentSession.flowPath,
      errorCount: this.currentSession.errorCount,
      hasCrash: this.currentSession.hasCrash,
    });

    this._notifyStatusListeners(status);
    this.currentSession = null;
    await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);
  }

  // ── Navigation / flow tracking ─────────────────────────────────────────────

  /**
   * Track a navigation event and update the active user flow.
   * Call this whenever the user navigates to a new screen.
   */
  async trackNavigation(flow: UserFlowStep, screenName?: string): Promise<void> {
    if (!this.currentSession) return;

    this.activeFlow = flow;
    this.currentSession.flowPath.push(flow);
    await this._persistCurrentSession();

    this._resetInactivityTimer();

    await this._trackEvent({
      type: 'navigation',
      flow,
      data: { screenName: screenName ?? flow },
    });
  }

  /**
   * Track a non-fatal error (increments error count, does not end session).
   */
  async trackError(error: Error, context?: Record<string, unknown>): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.errorCount += 1;
    await this._persistCurrentSession();

    await this._trackEvent({
      type: 'error',
      flow: this.activeFlow,
      data: {
        message: error.message,
        name: error.name,
        stack: error.stack,
        ...context,
      },
    });
  }

  /**
   * Report a fatal crash. Marks the session as crashed and sends a crash report.
   * This is the Sentry-equivalent of `captureException` with session marking.
   */
  async reportCrash(error: Error, context?: Record<string, unknown>): Promise<void> {
    if (!this.currentSession) {
      // Crash outside of a tracked session — still report it
      await this._sendCrashReport({
        sessionId: 'unknown',
        error: error.message,
        stack: error.stack,
        timestamp: Date.now(),
        appVersion: config.app.version,
        device: this._getDefaultDevice(),
        activeFlow: this.activeFlow,
        flowPath: [],
      });
      return;
    }

    this.currentSession.hasCrash = true;
    this.currentSession.status = 'crashed';

    const crashReport: CrashReport = {
      sessionId: this.currentSession.id,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now(),
      appVersion: this.currentSession.appVersion,
      device: this.currentSession.device,
      activeFlow: this.activeFlow,
      flowPath: [...this.currentSession.flowPath],
    };

    await this._persistCurrentSession();

    await this._trackEvent({
      type: 'crash',
      flow: this.activeFlow,
      data: {
        ...crashReport,
        sentrySessionStatus: 'crashed',
        ...context,
      },
    });

    await this._sendCrashReport(crashReport);

    // End the session as crashed
    await this.endSession('abnormal');

    this._notifyStatusListeners('crashed');
  }

  /**
   * Track a custom user action event.
   */
  async trackUserAction(action: string, data?: Record<string, unknown>): Promise<void> {
    if (!this.currentSession) return;

    this._resetInactivityTimer();

    await this._trackEvent({
      type: 'user_action',
      flow: this.activeFlow,
      data: { action, ...data },
    });
  }

  // ── Analytics ──────────────────────────────────────────────────────────────

  /**
   * Fetch crash-free session stats for a given app version.
   * Calculates crash-free rate and identifies top crash-prone flows.
   */
  async getCrashFreeStats(appVersion?: string): Promise<CrashFreeStats> {
    try {
      const params = appVersion ? `?appVersion=${encodeURIComponent(appVersion)}` : '';
      const response = await apiClient.get<{ success: true; data: CrashFreeStats }>(
        `/monitoring/analytics/crash-free${params}`,
      );

      const stats: CrashFreeStats = response.data.data;

      // Fire alert if rate is below threshold
      if (stats.isBelowThreshold) {
        const alert: AlertPayload = {
          type: 'crash_free_rate_below_threshold',
          appVersion: stats.appVersion,
          currentRate: stats.crashFreeRate,
          threshold: CRASH_FREE_THRESHOLD,
          timestamp: nowIso(),
        };
        this._notifyAlertListeners(alert);
        await this._sendAlert(alert);
      }

      return stats;
    } catch (err) {
      throw new SessionMonitoringError(
        `Failed to fetch crash-free stats: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'STATS_FETCH_FAILED',
      );
    }
  }

  // ── Session recovery ───────────────────────────────────────────────────────

  /**
   * Restore a session that was interrupted (e.g. app killed mid-session).
   * Call this on app startup to detect abnormal terminations.
   */
  async recoverInterruptedSession(): Promise<Session | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);
      if (!raw) return null;

      const session: Session = JSON.parse(raw);

      // If the session is still marked active but was started more than SESSION_TIMEOUT_MS ago,
      // it was abnormally terminated (app killed, OOM crash, etc.)
      const isStale = Date.now() - session.startedAt > SESSION_TIMEOUT_MS;
      if (session.status === 'active' && isStale) {
        session.status = 'abnormal';
        session.endedAt = Date.now();
        session.durationMs = session.endedAt - session.startedAt;

        // Report as an abnormal termination (Sentry: "abnormal" session)
        await this._sendToBackend('/monitoring/sessions/end', {
          sessionId: session.id,
          endedAt: new Date(session.endedAt).toISOString(),
          status: 'abnormal',
          durationMs: session.durationMs,
          flowPath: session.flowPath,
          errorCount: session.errorCount,
          hasCrash: session.hasCrash,
          recoveredFromInterruption: true,
        });

        await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);
        return session;
      }

      return null;
    } catch {
      return null;
    }
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to session status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(listener: (status: SessionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Subscribe to crash-free rate alerts.
   * Returns an unsubscribe function.
   */
  onAlert(listener: (alert: AlertPayload) => void): () => void {
    this.alertListeners.push(listener);
    return () => {
      this.alertListeners = this.alertListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Subscribe to session timeout warning events (fires 2 min before expiry).
   * Receives a countdown payload updated every second.
   * Returns an unsubscribe function.
   */
  onTimeoutWarning(listener: TimeoutWarningListener): () => void {
    this.timeoutWarningListeners.push(listener);
    return () => {
      this.timeoutWarningListeners = this.timeoutWarningListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Subscribe to session expiry (fires when the inactivity timeout has elapsed).
   * Returns an unsubscribe function.
   */
  onTimeoutExpired(listener: TimeoutExpiredListener): () => void {
    this.timeoutExpiredListeners.push(listener);
    return () => {
      this.timeoutExpiredListeners = this.timeoutExpiredListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Extend the current session (call after the user taps "Stay logged in").
   * Resets the inactivity timer and calls authService.refreshToken().
   */
  async extendSession(): Promise<void> {
    if (!this.currentSession) return;
    this._resetInactivityTimer();
    try {
      const { refreshToken } = await import('./authService');
      await refreshToken();
    } catch {
      // Non-fatal — session extension failure is not a crash
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  getCurrentSessionId(): string | null {
    return this.currentSession?.id ?? null;
  }

  getActiveFlow(): UserFlowStep {
    return this.activeFlow;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _trackEvent(partial: Pick<SessionEvent, 'type' | 'flow' | 'data'>): Promise<void> {
    const event: SessionEvent = {
      id: generateId(),
      sessionId: this.currentSession?.id ?? 'unknown',
      type: partial.type,
      flow: partial.flow,
      timestamp: Date.now(),
      data: partial.data,
    };

    // Buffer locally
    await this._bufferEvent(event);

    // Flush to backend (fire-and-forget — non-fatal if it fails)
    this._flushEvents().catch(() => {
      // Silently retain buffered events for next flush
    });
  }

  private async _bufferEvent(event: SessionEvent): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_EVENTS);
      const events: SessionEvent[] = raw ? JSON.parse(raw) : [];

      events.push(event);

      // Cap buffer size to avoid unbounded growth
      const trimmed = events.slice(-MAX_PENDING_EVENTS);
      await AsyncStorage.setItem(STORAGE_KEYS.PENDING_EVENTS, JSON.stringify(trimmed));
    } catch {
      // Non-fatal — buffering failure should not crash the app
    }
  }

  private async _flushEvents(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_EVENTS);
      if (!raw) return;

      const events: SessionEvent[] = JSON.parse(raw);
      if (events.length === 0) return;

      await apiClient.post('/monitoring/events', { events });
      await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_EVENTS);
    } catch {
      // Retain events for next flush attempt
    }
  }

  private async _sendToBackend(endpoint: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await apiClient.post(endpoint, payload);
    } catch {
      // Non-fatal — monitoring failures must never crash the app
    }
  }

  private async _sendCrashReport(report: CrashReport): Promise<void> {
    try {
      await apiClient.post('/monitoring/crashes', report);
    } catch {
      // Persist locally for retry on next launch
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.CRASH_HISTORY);
        const history: CrashReport[] = raw ? JSON.parse(raw) : [];
        history.push(report);
        await AsyncStorage.setItem(STORAGE_KEYS.CRASH_HISTORY, JSON.stringify(history.slice(-50)));
      } catch {
        // Nothing more we can do
      }
    }
  }

  private async _sendAlert(alert: AlertPayload): Promise<void> {
    try {
      await apiClient.post('/monitoring/alerts', alert);
    } catch {
      // Non-fatal
    }
  }

  private async _persistCurrentSession(): Promise<void> {
    if (!this.currentSession) return;
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(this.currentSession));
    } catch {
      // Non-fatal
    }
  }

  private _notifyStatusListeners(status: SessionStatus): void {
    this.statusListeners.forEach((l) => l(status));
  }

  private _notifyAlertListeners(alert: AlertPayload): void {
    this.alertListeners.forEach((l) => l(alert));
  }

  private _getDefaultDevice(): DeviceMetadata {
    return {
      model: 'unknown',
      os: 'unknown',
      osVersion: 'unknown',
      appVersion: config.app.version,
      platform: 'unknown',
    };
  }

  // ── Inactivity / warning timer helpers ────────────────────────────────────

  private _clearTimers(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.warningCountdownInterval) {
      clearInterval(this.warningCountdownInterval);
      this.warningCountdownInterval = null;
    }
    this.warningActive = false;
  }

  private _resetInactivityTimer(): void {
    if (!this.currentSession) return;
    this._clearTimers();

    const warningAt = SESSION_TIMEOUT_MS - WARNING_BEFORE_EXPIRY_MS;

    // Schedule warning at (SESSION_TIMEOUT_MS - 2 minutes)
    this.warningTimer = setTimeout(() => {
      this._startWarningCountdown();
    }, warningAt);
  }

  private _startWarningCountdown(): void {
    if (!this.currentSession) return;
    this.warningActive = true;
    let secondsRemaining = Math.round(WARNING_BEFORE_EXPIRY_MS / 1000);

    // Emit initial warning
    this.timeoutWarningListeners.forEach((l) => l({ secondsRemaining }));

    // Tick every second
    this.warningCountdownInterval = setInterval(() => {
      secondsRemaining -= 1;
      this.timeoutWarningListeners.forEach((l) => l({ secondsRemaining }));

      if (secondsRemaining <= 0) {
        if (this.warningCountdownInterval) clearInterval(this.warningCountdownInterval);
        this.warningCountdownInterval = null;
        this.warningActive = false;
        // Fire expiry — UI/caller should call authService.logout()
        this.timeoutExpiredListeners.forEach((l) => l());
        this.endSession('ended').catch(() => {});
      }
    }, 1000);
  }
}

export default new SessionMonitoringService();
