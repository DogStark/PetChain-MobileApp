// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionEventType = 'trial_start' | 'conversion' | 'renewal' | 'cancellation';
export type SubscriptionPlan = 'monthly' | 'annual';
export type ChurnRisk = 'low' | 'medium' | 'high';

export interface SubscriptionEvent {
  id: string;
  userId: string;
  type: SubscriptionEventType;
  plan: SubscriptionPlan;
  amount: number; // in cents
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Subscriber {
  userId: string;
  plan: SubscriptionPlan;
  monthlyAmount: number; // normalised to monthly
  startedAt: number;
  lastActivityAt: number;
  loginCount: number;
  featureUsageCount: number;
  supportTickets: number;
  isActive: boolean;
}

export interface ChurnPrediction {
  userId: string;
  risk: ChurnRisk;
  score: number; // 0–1, higher = more likely to churn
  signals: string[];
}

export interface SubscriptionMetrics {
  mrr: number;
  arr: number;
  churnRate: number;
  ltv: number;
  activeSubscribers: number;
  newSubscribers: number;
  cancelledSubscribers: number;
  atRiskSubscribers: ChurnPrediction[];
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const events: SubscriptionEvent[] = [];
const subscribers = new Map<string, Subscriber>();

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Record a subscription lifecycle event and update subscriber state.
 */
export function recordEvent(event: SubscriptionEvent): void {
  events.push(event);

  const existing = subscribers.get(event.userId);
  const monthlyAmount = event.plan === 'annual' ? Math.round(event.amount / 12) : event.amount;

  switch (event.type) {
    case 'trial_start':
    case 'conversion':
    case 'renewal': {
      const sub: Subscriber = existing ?? {
        userId: event.userId,
        plan: event.plan,
        monthlyAmount,
        startedAt: event.timestamp,
        lastActivityAt: event.timestamp,
        loginCount: 0,
        featureUsageCount: 0,
        supportTickets: 0,
        isActive: true,
      };
      sub.isActive = true;
      sub.plan = event.plan;
      sub.monthlyAmount = monthlyAmount;
      sub.lastActivityAt = event.timestamp;
      subscribers.set(event.userId, sub);
      break;
    }
    case 'cancellation': {
      if (existing) {
        existing.isActive = false;
        existing.lastActivityAt = event.timestamp;
        subscribers.set(event.userId, existing);
      }
      break;
    }
  }
}

/**
 * Update engagement signals for a subscriber (used by churn prediction).
 */
export function updateEngagement(
  userId: string,
  signals: Partial<
    Pick<Subscriber, 'loginCount' | 'featureUsageCount' | 'supportTickets' | 'lastActivityAt'>
  >,
): void {
  const sub = subscribers.get(userId);
  if (!sub) return;
  Object.assign(sub, signals);
  subscribers.set(userId, sub);
}

/**
 * Monthly Recurring Revenue (sum of active subscriber monthly amounts).
 */
export function calculateMRR(): number {
  let total = 0;
  for (const sub of subscribers.values()) {
    if (sub.isActive) total += sub.monthlyAmount;
  }
  return total;
}

/**
 * Annual Recurring Revenue = MRR × 12.
 */
export function calculateARR(): number {
  return calculateMRR() * 12;
}

/**
 * Churn rate = cancelled this period / active at start of period.
 * Uses a rolling 30-day window.
 */
export function calculateChurnRate(windowMs = 30 * 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  const windowStart = now - windowMs;

  const cancelledInWindow = events.filter(
    (e) => e.type === 'cancellation' && e.timestamp >= windowStart,
  ).length;

  // Active at start of window = currently active + cancelled within window
  const activeAtStart = cancelledInWindow + countActiveSubscribers();
  if (activeAtStart === 0) return 0;

  return cancelledInWindow / activeAtStart;
}

/**
 * Customer Lifetime Value = average monthly revenue / churn rate.
 * Falls back to average tenure × ARPU when churn rate is 0.
 */
export function calculateLTV(): number {
  const active = [...subscribers.values()].filter((s) => s.isActive);
  if (active.length === 0) return 0;

  const arpu = calculateMRR() / active.length;
  const churnRate = calculateChurnRate();

  if (churnRate > 0) {
    return arpu / churnRate;
  }

  // Fallback: average tenure in months × ARPU
  const now = Date.now();
  const avgTenureMs = active.reduce((sum, s) => sum + (now - s.startedAt), 0) / active.length;
  const avgTenureMonths = avgTenureMs / (30 * 24 * 60 * 60 * 1000);
  return arpu * Math.max(avgTenureMonths, 1);
}

/**
 * Predict churn risk for all active subscribers using engagement signals.
 *
 * Scoring model (0–1):
 *   - Days since last activity  (weight 0.4)
 *   - Low login count           (weight 0.3)
 *   - Low feature usage         (weight 0.2)
 *   - High support tickets      (weight 0.1)
 */
export function predictChurn(): ChurnPrediction[] {
  const now = Date.now();
  const predictions: ChurnPrediction[] = [];

  for (const sub of subscribers.values()) {
    if (!sub.isActive) continue;

    const signals: string[] = [];
    let score = 0;

    // Days since last activity
    const daysSinceActivity = (now - sub.lastActivityAt) / (24 * 60 * 60 * 1000);
    if (daysSinceActivity > 30) {
      score += 0.4;
      signals.push('inactive_30_days');
    } else if (daysSinceActivity > 14) {
      score += 0.2;
      signals.push('inactive_14_days');
    }

    // Login frequency
    const tenureDays = Math.max((now - sub.startedAt) / (24 * 60 * 60 * 1000), 1);
    const loginsPerDay = sub.loginCount / tenureDays;
    if (loginsPerDay < 0.1) {
      score += 0.3;
      signals.push('low_login_frequency');
    } else if (loginsPerDay < 0.3) {
      score += 0.15;
      signals.push('below_avg_login_frequency');
    }

    // Feature usage
    const usagePerDay = sub.featureUsageCount / tenureDays;
    if (usagePerDay < 0.2) {
      score += 0.2;
      signals.push('low_feature_usage');
    }

    // Support tickets (frustration signal)
    if (sub.supportTickets >= 3) {
      score += 0.1;
      signals.push('high_support_tickets');
    }

    const risk: ChurnRisk = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low';
    predictions.push({ userId: sub.userId, risk, score: Math.min(score, 1), signals });
  }

  return predictions.sort((a, b) => b.score - a.score);
}

/**
 * Aggregate all subscription metrics.
 */
export function getMetrics(windowMs?: number): SubscriptionMetrics {
  const now = Date.now();
  const windowStart = now - (windowMs ?? 30 * 24 * 60 * 60 * 1000);

  const newSubscribers = events.filter(
    (e) => e.type === 'conversion' && e.timestamp >= windowStart,
  ).length;

  const cancelledSubscribers = events.filter(
    (e) => e.type === 'cancellation' && e.timestamp >= windowStart,
  ).length;

  return {
    mrr: calculateMRR(),
    arr: calculateARR(),
    churnRate: calculateChurnRate(windowMs),
    ltv: calculateLTV(),
    activeSubscribers: countActiveSubscribers(),
    newSubscribers,
    cancelledSubscribers,
    atRiskSubscribers: predictChurn().filter((p) => p.risk !== 'low'),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countActiveSubscribers(): number {
  let count = 0;
  for (const sub of subscribers.values()) {
    if (sub.isActive) count++;
  }
  return count;
}

/** Exposed for testing / seeding */
export function _reset(): void {
  events.length = 0;
  subscribers.clear();
}

export function _getSubscribers(): Map<string, Subscriber> {
  return subscribers;
}

export function _getEvents(): SubscriptionEvent[] {
  return events;
}
