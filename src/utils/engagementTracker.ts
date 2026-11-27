import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  LAST_PROMPT: 'review_last_prompt_ts',
  PROMPT_COUNT: 'review_prompt_count',
  POSITIVE_EVENTS: 'review_positive_events',
  AB_VARIANT: 'review_ab_variant',
  MILESTONES: 'review_milestones',
};

/** Minimum time between two in-app review prompts. */
export const REVIEW_COOLDOWN_DAYS = 60;

export type EngagementEvent =
  | 'sos_success'
  | 'record_saved'
  | 'appointment_completed'
  | 'error_occurred'
  | 'payment_failed'
  | 'dose_confirmed'
  | 'appointment_booked'
  | 'record_verified';

/** Milestones that unlock the in-app review prompt once reached. */
export type ReviewMilestone = 'dose_confirmed' | 'appointment_booked' | 'record_verified';

export const MILESTONE_THRESHOLDS: Record<ReviewMilestone, number> = {
  dose_confirmed: 5,
  appointment_booked: 3,
  record_verified: 1,
};

const POSITIVE_EVENTS: EngagementEvent[] = [
  'sos_success',
  'record_saved',
  'appointment_completed',
  'dose_confirmed',
  'appointment_booked',
  'record_verified',
];

export const NEGATIVE_EVENTS: EngagementEvent[] = ['error_occurred', 'payment_failed'];

type MilestoneCounts = Record<ReviewMilestone, number>;

const EMPTY_MILESTONES: MilestoneCounts = {
  dose_confirmed: 0,
  appointment_booked: 0,
  record_verified: 0,
};

async function readMilestones(): Promise<MilestoneCounts> {
  const raw = await AsyncStorage.getItem(KEYS.MILESTONES);
  if (!raw) return { ...EMPTY_MILESTONES };
  try {
    const parsed = JSON.parse(raw) as Partial<MilestoneCounts>;
    return {
      dose_confirmed: Number(parsed.dose_confirmed) || 0,
      appointment_booked: Number(parsed.appointment_booked) || 0,
      record_verified: Number(parsed.record_verified) || 0,
    };
  } catch {
    return { ...EMPTY_MILESTONES };
  }
}

export const engagementTracker = {
  async recordEvent(event: EngagementEvent): Promise<void> {
    if (!POSITIVE_EVENTS.includes(event)) return;

    const raw = await AsyncStorage.getItem(KEYS.POSITIVE_EVENTS);
    const count = raw ? parseInt(raw, 10) : 0;
    await AsyncStorage.setItem(KEYS.POSITIVE_EVENTS, String(count + 1));

    if (event in MILESTONE_THRESHOLDS) {
      const milestones = await readMilestones();
      const milestone = event as ReviewMilestone;
      milestones[milestone] += 1;
      await AsyncStorage.setItem(KEYS.MILESTONES, JSON.stringify(milestones));
    }
  },

  /** True once any review milestone (5 doses, 3 bookings, 1 verified record) is reached. */
  async hasReachedMilestone(): Promise<boolean> {
    const milestones = await readMilestones();
    return (Object.keys(MILESTONE_THRESHOLDS) as ReviewMilestone[]).some(
      (milestone) => milestones[milestone] >= MILESTONE_THRESHOLDS[milestone],
    );
  },

  async isEligibleForPrompt(): Promise<boolean> {
    const lastPrompt = await AsyncStorage.getItem(KEYS.LAST_PROMPT);
    if (lastPrompt) {
      const daysSince = (Date.now() - parseInt(lastPrompt, 10)) / (1000 * 60 * 60 * 24);
      if (daysSince < REVIEW_COOLDOWN_DAYS) return false;
    }

    return engagementTracker.hasReachedMilestone();
  },

  async recordPromptShown(): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_PROMPT, String(Date.now()));

    const raw = await AsyncStorage.getItem(KEYS.PROMPT_COUNT);
    const count = raw ? parseInt(raw, 10) : 0;
    await AsyncStorage.setItem(KEYS.PROMPT_COUNT, String(count + 1));
  },

  async getABVariant(): Promise<'immediate' | 'delayed'> {
    const stored = await AsyncStorage.getItem(KEYS.AB_VARIANT);
    if (stored === 'immediate' || stored === 'delayed') return stored;

    const variant = Math.random() < 0.5 ? 'immediate' : 'delayed';
    await AsyncStorage.setItem(KEYS.AB_VARIANT, variant);
    return variant;
  },
};
