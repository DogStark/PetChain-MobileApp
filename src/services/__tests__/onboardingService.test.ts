import { encryptedAsyncStorage } from '../../utils/encryptedAsyncStorage';
import onboardingService, {
  isMandatoryStep,
  MANDATORY_STEPS,
  resolveResumeStep,
  STEP_SEQUENCES,
  type OnboardingState,
} from '../onboardingService';

jest.mock('../../utils/encryptedAsyncStorage', () => ({
  encryptedAsyncStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('../analyticsService', () => ({
  __esModule: true,
  default: {
    featureUsed: jest.fn(),
  },
}));

const memoryStore = new Map<string, string>();

beforeEach(() => {
  memoryStore.clear();
  jest.clearAllMocks();
  (encryptedAsyncStorage.getItem as jest.Mock).mockImplementation(
    async (key: string) => memoryStore.get(key) ?? null,
  );
  (encryptedAsyncStorage.setItem as jest.Mock).mockImplementation(
    async (key: string, value: string) => {
      memoryStore.set(key, value);
    },
  );
  (encryptedAsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    memoryStore.delete(key);
  });
});

describe('onboardingService skip and crash-resume capability', () => {
  it('identifies mandatory steps (pet setup = 1, notifications = 2)', () => {
    expect(MANDATORY_STEPS).toEqual([1, 2]);
    expect(isMandatoryStep(1)).toBe(true);
    expect(isMandatoryStep(2)).toBe(true);
    expect(isMandatoryStep(0)).toBe(false);
    expect(isMandatoryStep(3)).toBe(false);
    expect(isMandatoryStep(4)).toBe(false);
    expect(isMandatoryStep(5)).toBe(false);
  });

  it('persists skipped non-mandatory steps and blocks skipping mandatory steps', async () => {
    const initial: OnboardingState = {
      currentStep: 0,
      completedSteps: [],
      skippedSteps: [],
      variant: 'A',
      completed: false,
      startedAt: Date.now(),
    };

    const afterWelcomeSkip = await onboardingService.skipStep(initial, 0);
    expect(afterWelcomeSkip.skippedSteps).toEqual([0]);
    expect(afterWelcomeSkip.currentStep).toBe(1);

    await expect(onboardingService.skipStep(afterWelcomeSkip, 1)).rejects.toThrow(/mandatory/i);
    await expect(onboardingService.skipStep(afterWelcomeSkip, 2)).rejects.toThrow(/mandatory/i);

    const afterBioSkip = await onboardingService.skipStep(
      { ...afterWelcomeSkip, completedSteps: [1, 2], currentStep: 3 },
      3,
    );
    expect(afterBioSkip.skippedSteps).toEqual([0, 3]);
    expect(afterBioSkip.currentStep).toBe(4);
  });

  it('persists completed steps and resumes from the first incomplete step after a crash', async () => {
    const preCrashState: OnboardingState = {
      currentStep: 2,
      completedSteps: [0, 1],
      skippedSteps: [5],
      variant: 'B',
      completed: false,
      startedAt: Date.now() - 1000,
    };

    // Variant B order is [0, 1, 5, 2, 3, 4]: after 0, 1, 5, resume position is 3 (step 2)
    memoryStore.set('onboarding_state', JSON.stringify(preCrashState));
    const resumed = await onboardingService.init();

    expect(resumed.completedSteps).toEqual([0, 1]);
    expect(resumed.skippedSteps).toEqual([5]);
    expect(resumed.currentStep).toBe(STEP_SEQUENCES.B.indexOf(2));
    expect(resolveResumeStep(preCrashState)).toBe(3);

    const afterMandatory = await onboardingService.advanceStep(resumed, 2);
    expect(afterMandatory.completedSteps).toEqual([0, 1, 2]);
    expect(afterMandatory.currentStep).toBe(4);
  });
});
