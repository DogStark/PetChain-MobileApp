export type EventType = 'screen_view' | 'feature_usage' | 'error';

export interface AnalyticsEvent {
  type: EventType;
  name: string;
  meta?: Record<string, unknown>;
  timestamp: number;
}

const events: AnalyticsEvent[] = [];

function recordEvent(event: AnalyticsEvent): void {
  events.push(event);
}

function getDashboard() {
  const counts: Record<EventType, Record<string, number>> = {
    screen_view: {},
    feature_usage: {},
    error: {},
  };

  for (const e of events) {
    counts[e.type][e.name] = (counts[e.type][e.name] ?? 0) + 1;
  }

  return {
    totalEvents: events.length,
    screenViews: counts.screen_view,
    featureUsage: counts.feature_usage,
    errors: counts.error,
  };
}

export default { recordEvent, getDashboard };
