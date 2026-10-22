import {
  _getSubscribers,
  _reset,
  calculateARR,
  calculateChurnRate,
  calculateLTV,
  calculateMRR,
  getMetrics,
  predictChurn,
  recordEvent,
  updateEngagement,
  type SubscriptionEvent,
} from '../subscriptionAnalyticsService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  return {
    id: `evt_${Math.random()}`,
    userId: 'user-1',
    type: 'conversion',
    plan: 'monthly',
    amount: 1000, // $10.00 in cents
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _reset();
});

// ── MRR ───────────────────────────────────────────────────────────────────────

describe('calculateMRR', () => {
  it('returns 0 when there are no subscribers', () => {
    expect(calculateMRR()).toBe(0);
  });

  it('sums monthly amounts for active subscribers', () => {
    recordEvent(makeEvent({ userId: 'u1', plan: 'monthly', amount: 1000 }));
    recordEvent(makeEvent({ userId: 'u2', plan: 'monthly', amount: 2000 }));
    expect(calculateMRR()).toBe(3000);
  });

  it('normalises annual plan to monthly (amount / 12)', () => {
    recordEvent(makeEvent({ userId: 'u1', plan: 'annual', amount: 12000 }));
    expect(calculateMRR()).toBe(1000);
  });

  it('excludes cancelled subscribers', () => {
    recordEvent(makeEvent({ userId: 'u1', plan: 'monthly', amount: 1000 }));
    recordEvent(makeEvent({ userId: 'u1', type: 'cancellation', amount: 0 }));
    expect(calculateMRR()).toBe(0);
  });

  it('counts only the latest state when a subscriber renews after cancellation', () => {
    recordEvent(makeEvent({ userId: 'u1', plan: 'monthly', amount: 1000 }));
    recordEvent(makeEvent({ userId: 'u1', type: 'cancellation', amount: 0 }));
    recordEvent(makeEvent({ userId: 'u1', type: 'renewal', plan: 'monthly', amount: 1500 }));
    expect(calculateMRR()).toBe(1500);
  });
});

// ── ARR ───────────────────────────────────────────────────────────────────────

describe('calculateARR', () => {
  it('returns MRR × 12', () => {
    recordEvent(makeEvent({ userId: 'u1', plan: 'monthly', amount: 1000 }));
    expect(calculateARR()).toBe(calculateMRR() * 12);
  });
});

// ── Churn rate ────────────────────────────────────────────────────────────────

describe('calculateChurnRate', () => {
  it('returns 0 when no cancellations', () => {
    recordEvent(makeEvent({ userId: 'u1' }));
    expect(calculateChurnRate()).toBe(0);
  });

  it('calculates rate correctly', () => {
    const now = Date.now();
    // 2 active subscribers
    recordEvent(makeEvent({ userId: 'u1', timestamp: now - 1000 }));
    recordEvent(makeEvent({ userId: 'u2', timestamp: now - 1000 }));
    // 1 cancels within window
    recordEvent(makeEvent({ userId: 'u1', type: 'cancellation', amount: 0, timestamp: now }));
    // churnRate = 1 cancelled / (1 active + 1 cancelled) = 0.5
    expect(calculateChurnRate()).toBeCloseTo(0.5);
  });

  it('ignores cancellations outside the window', () => {
    const now = Date.now();
    const oldCancellation = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago
    recordEvent(makeEvent({ userId: 'u1', timestamp: oldCancellation - 1000 }));
    recordEvent(
      makeEvent({ userId: 'u1', type: 'cancellation', amount: 0, timestamp: oldCancellation }),
    );
    recordEvent(makeEvent({ userId: 'u2', timestamp: now - 1000 }));
    // 30-day window: no cancellations → rate = 0
    expect(calculateChurnRate()).toBe(0);
  });
});

// ── LTV ───────────────────────────────────────────────────────────────────────

describe('calculateLTV', () => {
  it('returns 0 when no active subscribers', () => {
    expect(calculateLTV()).toBe(0);
  });

  it('returns arpu / churnRate when churn > 0', () => {
    const now = Date.now();
    recordEvent(makeEvent({ userId: 'u1', plan: 'monthly', amount: 1000, timestamp: now - 1000 }));
    recordEvent(makeEvent({ userId: 'u2', plan: 'monthly', amount: 1000, timestamp: now - 1000 }));
    recordEvent(makeEvent({ userId: 'u1', type: 'cancellation', amount: 0, timestamp: now }));

    const mrr = calculateMRR(); // 1000 (only u2 active)
    const arpu = mrr / 1; // 1 active subscriber
    const churnRate = calculateChurnRate();
    expect(calculateLTV()).toBeCloseTo(arpu / churnRate);
  });

  it('falls back to tenure-based LTV when churn rate is 0', () => {
    recordEvent(makeEvent({ userId: 'u1', plan: 'monthly', amount: 1000 }));
    const ltv = calculateLTV();
    expect(ltv).toBeGreaterThan(0);
  });
});

// ── Churn prediction ──────────────────────────────────────────────────────────

describe('predictChurn', () => {
  it('returns empty array when no active subscribers', () => {
    expect(predictChurn()).toEqual([]);
  });

  it('assigns high risk to inactive subscriber with low engagement', () => {
    const now = Date.now();
    const thirtyFiveDaysAgo = now - 35 * 24 * 60 * 60 * 1000;

    recordEvent(makeEvent({ userId: 'u1', timestamp: thirtyFiveDaysAgo }));
    updateEngagement('u1', {
      loginCount: 0,
      featureUsageCount: 0,
      supportTickets: 5,
      lastActivityAt: thirtyFiveDaysAgo,
    });

    const predictions = predictChurn();
    expect(predictions).toHaveLength(1);
    expect(predictions[0].risk).toBe('high');
    expect(predictions[0].signals).toContain('inactive_30_days');
    expect(predictions[0].signals).toContain('low_login_frequency');
  });

  it('assigns low risk to engaged subscriber', () => {
    const now = Date.now();
    recordEvent(makeEvent({ userId: 'u1', timestamp: now - 5 * 24 * 60 * 60 * 1000 }));
    updateEngagement('u1', {
      loginCount: 50,
      featureUsageCount: 100,
      supportTickets: 0,
      lastActivityAt: now - 1 * 24 * 60 * 60 * 1000,
    });

    const predictions = predictChurn();
    expect(predictions[0].risk).toBe('low');
    expect(predictions[0].score).toBeLessThan(0.3);
  });

  it('excludes cancelled subscribers', () => {
    recordEvent(makeEvent({ userId: 'u1' }));
    recordEvent(makeEvent({ userId: 'u1', type: 'cancellation', amount: 0 }));
    expect(predictChurn()).toHaveLength(0);
  });

  it('sorts predictions by score descending', () => {
    const now = Date.now();
    // High-risk user
    recordEvent(makeEvent({ userId: 'u1', timestamp: now - 40 * 24 * 60 * 60 * 1000 }));
    updateEngagement('u1', {
      loginCount: 0,
      featureUsageCount: 0,
      lastActivityAt: now - 40 * 24 * 60 * 60 * 1000,
    });
    // Low-risk user
    recordEvent(makeEvent({ userId: 'u2', timestamp: now - 2 * 24 * 60 * 60 * 1000 }));
    updateEngagement('u2', { loginCount: 30, featureUsageCount: 60, lastActivityAt: now });

    const predictions = predictChurn();
    expect(predictions[0].userId).toBe('u1');
    expect(predictions[0].score).toBeGreaterThan(predictions[1].score);
  });
});

// ── getMetrics ────────────────────────────────────────────────────────────────

describe('getMetrics', () => {
  it('returns all required metric fields', () => {
    recordEvent(makeEvent({ userId: 'u1', plan: 'monthly', amount: 2000 }));
    const metrics = getMetrics();

    expect(metrics).toHaveProperty('mrr');
    expect(metrics).toHaveProperty('arr');
    expect(metrics).toHaveProperty('churnRate');
    expect(metrics).toHaveProperty('ltv');
    expect(metrics).toHaveProperty('activeSubscribers');
    expect(metrics).toHaveProperty('newSubscribers');
    expect(metrics).toHaveProperty('cancelledSubscribers');
    expect(metrics).toHaveProperty('atRiskSubscribers');
  });

  it('counts new and cancelled subscribers within window', () => {
    const now = Date.now();
    recordEvent(makeEvent({ userId: 'u1', type: 'conversion', timestamp: now - 1000 }));
    recordEvent(makeEvent({ userId: 'u2', type: 'conversion', timestamp: now - 1000 }));
    recordEvent(makeEvent({ userId: 'u2', type: 'cancellation', amount: 0, timestamp: now }));

    const metrics = getMetrics();
    expect(metrics.newSubscribers).toBe(2);
    expect(metrics.cancelledSubscribers).toBe(1);
    expect(metrics.activeSubscribers).toBe(1);
  });

  it('only includes medium/high risk in atRiskSubscribers', () => {
    const now = Date.now();
    // High-risk
    recordEvent(makeEvent({ userId: 'u1', timestamp: now - 40 * 24 * 60 * 60 * 1000 }));
    updateEngagement('u1', {
      loginCount: 0,
      featureUsageCount: 0,
      lastActivityAt: now - 40 * 24 * 60 * 60 * 1000,
    });
    // Low-risk
    recordEvent(makeEvent({ userId: 'u2', timestamp: now - 1 * 24 * 60 * 60 * 1000 }));
    updateEngagement('u2', { loginCount: 50, featureUsageCount: 100, lastActivityAt: now });

    const metrics = getMetrics();
    expect(metrics.atRiskSubscribers.every((p) => p.risk !== 'low')).toBe(true);
  });
});
