import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  LAST_PROMPT: 'review_last_prompt_ts',
  PROMPT_COUNT: 'review_prompt_count',
  POSITIVE_EVENTS: 'review_positive_events',
  AB_VARIANT: 'review_ab_variant',
};

export type EngagementEvent =
  | 'sos_success'
  | 'record_saved'
  | 'appointment_completed'
  | 'error_occurred'
  | 'payment_failed';

const POSITIVE_EVENTS: EngagementEvent[] = ['sos_success', 'record_saved', 'appointment_completed'];

export const NEGATIVE_EVENTS: EngagementEvent[] = ['error_occurred', 'payment_failed'];

export const engagementTracker = {
  async recordEvent(event: EngagementEvent): Promise<void> {
    if (!POSITIVE_EVENTS.includes(event)) return;

    const raw = await AsyncStorage.getItem(KEYS.POSITIVE_EVENTS);
    const count = raw ? parseInt(raw, 10) : 0;
    await AsyncStorage.setItem(KEYS.POSITIVE_EVENTS, String(count + 1));
  },

  async isEligibleForPrompt(): Promise<boolean> {
    const lastPrompt = await AsyncStorage.getItem(KEYS.LAST_PROMPT);
    if (lastPrompt) {
      const daysSince = (Date.now() - parseInt(lastPrompt, 10)) / (1000 * 60 * 60 * 24);
      if (daysSince < 90) return false;
    }

    const positiveRaw = await AsyncStorage.getItem(KEYS.POSITIVE_EVENTS);
    const positiveCount = positiveRaw ? parseInt(positiveRaw, 10) : 0;
    return positiveCount >= 3;
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
