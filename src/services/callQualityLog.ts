/**
 * Call quality diagnostics log (Issue #1370)
 *
 * Records every network-quality transition and manual quality change (e.g.
 * switching to audio-only) that happens during a video consultation, so the
 * session can be diagnosed after the fact.
 *
 * Entries are kept in memory for the lifetime of the call and posted to the
 * backend on a best-effort basis; a network failure never blocks the call.
 */

import apiClient from './apiClient';
import { logError } from '../utils/errorLogger';

export type CallNetworkQuality = 'excellent' | 'good' | 'poor' | 'critical' | 'off';

export type CallQualityEventType =
  | 'quality_change'
  | 'bitrate_reduced'
  | 'audio_only_enabled'
  | 'audio_only_disabled';

export interface CallQualityEvent {
  consultationId: string;
  participantId: string;
  type: CallQualityEventType;
  /** Quality tier after the change, when applicable. */
  quality?: CallNetworkQuality;
  /** Previous quality tier, for transitions. */
  previousQuality?: CallNetworkQuality;
  /** Applied video bitrate cap in bits per second, when applicable. */
  maxBitrateBps?: number;
  packetLossPct?: number;
  rttMs?: number;
  /** ISO-8601 timestamp of the event. */
  recordedAt: string;
}

const sessionEvents = new Map<string, CallQualityEvent[]>();

function key(consultationId: string, participantId: string): string {
  return `${consultationId}:${participantId}`;
}

/**
 * Append an event to the session log and report it to the backend.
 * Never throws.
 */
export async function logCallQualityEvent(
  input: Omit<CallQualityEvent, 'recordedAt'>,
): Promise<CallQualityEvent> {
  const event: CallQualityEvent = { ...input, recordedAt: new Date().toISOString() };

  const k = key(input.consultationId, input.participantId);
  const existing = sessionEvents.get(k);
  if (existing) {
    existing.push(event);
  } else {
    sessionEvents.set(k, [event]);
  }

  try {
    await apiClient.post(
      `/consultations/${encodeURIComponent(input.consultationId)}/quality-events`,
      {
        participantId: event.participantId,
        type: event.type,
        quality: event.quality,
        previousQuality: event.previousQuality,
        maxBitrateBps: event.maxBitrateBps,
        packetLossPct: event.packetLossPct,
        rttMs: event.rttMs,
        recordedAt: event.recordedAt,
      },
    );
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      service: 'callQualityLog',
      action: 'logCallQualityEvent',
      type: event.type,
    });
  }

  return event;
}

/** All quality events recorded for this participant's session. */
export function getCallQualityEvents(
  consultationId: string,
  participantId: string,
): CallQualityEvent[] {
  return [...(sessionEvents.get(key(consultationId, participantId)) ?? [])];
}

/** Drop this session's events — call when the call ends. */
export function clearCallQualityEvents(consultationId: string, participantId: string): void {
  sessionEvents.delete(key(consultationId, participantId));
}
