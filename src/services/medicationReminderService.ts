import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { TimestampTrigger, TriggerType } from '@notifee/react-native';
import { Medication, MedicationSchedule, DoseLog } from '../types/medication';
import { apiClient } from '../api/client';

const REMINDER_CHANNEL_ID = 'medication-reminders';
const CLOCK_STATE_KEY = '@medication/clock_state';
const PENDING_DOSE_KEY = '@medication/pending_doses';

// A jump larger than this (in ms) is treated as a device-clock tamper.
const CLOCK_JUMP_THRESHOLD_MS = 5 * 60 * 1000;
// A dose logged more than this far in the future is never recorded silently.
const FUTURE_DOSE_TOLERANCE_MS = 2 * 60 * 1000;

export interface ClockState {
  lastKnownDeviceTime: number;
  lastKnownServerTime: number | null;
  trusted: boolean;
  reason?: 'forward-jump' | 'backward-jump' | 'timezone-change' | 'dst-transition' | 'server-mismatch';
}

export interface ClockWarning {
  code: ClockState['reason'];
  message: string;
  actionable: string;
}

export interface DoseLogResult {
  recorded: boolean;
  queued: boolean;
  warning?: ClockWarning;
  doseLog?: DoseLog;
}

function buildWarning(reason: ClockState['reason']): ClockWarning {
  switch (reason) {
    case 'forward-jump':
      return {
        code: reason,
        message: 'Your device clock jumped forward.',
        actionable: 'Check your date & time settings, then sync to confirm your schedule.',
      };
    case 'backward-jump':
      return {
        code: reason,
        message: 'Your device clock jumped backward.',
        actionable: 'Check your date & time settings, then sync to confirm your schedule.',
      };
    case 'timezone-change':
      return {
        code: reason,
        message: 'Your timezone changed.',
        actionable: 'Review your medication times to make sure they still match your routine.',
      };
    case 'dst-transition':
      return {
        code: reason,
        message: 'Daylight saving time changed.',
        actionable: 'Review your medication times to make sure they still match your routine.',
      };
    default:
      return {
        code: 'server-mismatch',
        message: 'Your device clock does not match our records.',
        actionable: 'Sync when you are online so we can reconcile your schedule.',
      };
  }
}

class MedicationReminderService {
  private clockState: ClockState = {
    lastKnownDeviceTime: Date.now(),
    lastKnownServerTime: null,
    trusted: true,
  };

  private pendingDoses: DoseLog[] = [];

  async init(): Promise<void> {
    await this.loadClockState();
    await this.loadPendingDoses();
    await this.ensureChannel();
  }

  private async ensureChannel(): Promise<void> {
    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id: REMINDER_CHANNEL_ID,
        name: 'Medication Reminders',
        importance: 4,
      });
    }
  }

  private async loadClockState(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(CLOCK_STATE_KEY);
      if (raw) {
        this.clockState = JSON.parse(raw) as ClockState;
      }
    } catch {
      // Fall back to defaults; a corrupt state must not block reminders.
    }
  }

  private async persistClockState(): Promise<void> {
    try {
      await AsyncStorage.setItem(CLOCK_STATE_KEY, JSON.stringify(this.clockState));
    } catch {
      // Persistence failure should not crash reminder flows.
    }
  }

  private async loadPendingDoses(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(PENDING_DOSE_KEY);
      if (raw) {
        this.pendingDoses = JSON.parse(raw) as DoseLog[];
      }
    } catch {
      this.pendingDoses = [];
    }
  }

  private async persistPendingDoses(): Promise<void> {
    try {
      await AsyncStorage.setItem(PENDING_DOSE_KEY, JSON.stringify(this.pendingDoses));
    } catch {
      // Ignore; queued doses remain in memory for this session.
    }
  }

  /**
   * Compare device time against trusted server/ledger time and detect jumps.
   * Called on app resume and before reminder/dose-log flows.
   */
  async checkClock(serverTime?: number | null): Promise<ClockState> {
    const now = Date.now();
    const previous = this.clockState;
    const elapsed = now - previous.lastKnownDeviceTime;

    let reason: ClockState['reason'] | undefined;

    if (serverTime != null) {
      const drift = Math.abs(now - serverTime);
      if (drift > CLOCK_JUMP_THRESHOLD_MS) {
        reason = 'server-mismatch';
      }
    }

    if (!reason && Math.abs(elapsed) > CLOCK_JUMP_THRESHOLD_MS) {
      reason = elapsed > 0 ? 'forward-jump' : 'backward-jump';
    }

    if (!reason && previous.lastKnownServerTime != null && serverTime != null) {
      const serverElapsed = serverTime - previous.lastKnownServerTime;
      const deviceElapsed = now - previous.lastKnownDeviceTime;
      if (Math.abs(serverElapsed - deviceElapsed) > CLOCK_JUMP_THRESHOLD_MS) {
        reason = 'timezone-change';
      }
    }

    this.clockState = {
      lastKnownDeviceTime: now,
      lastKnownServerTime: serverTime ?? previous.lastKnownServerTime,
      trusted: !reason,
      reason,
    };
    await this.persistClockState();

    return this.clockState;
  }

  /**
   * Called on app resume. Reconciles with the server when reachable and
   * surfaces a warning when the device clock is untrusted.
   */
  async onAppResume(): Promise<ClockWarning | null> {
    let serverTime: number | null = null;
    try {
      const response = await apiClient.get('/time');
      serverTime = response?.data?.serverTime ?? null;
    } catch {
      // Offline: fall back to device-only jump detection.
    }

    const state = await this.checkClock(serverTime);
    return state.trusted ? null : buildWarning(state.reason);
  }

  isClockTrusted(): boolean {
    return this.clockState.trusted;
  }

  getClockWarning(): ClockWarning | null {
    return this.clockState.trusted ? null : buildWarning(this.clockState.reason);
  }

  /**
   * Schedules reminders. When the clock is untrusted we still allow viewing
   * schedules offline but avoid arming triggers against a bad clock.
   */
  async scheduleReminders(medications: Medication[]): Promise<ClockWarning | null> {
    const state = await this.checkClock();
    if (!state.trusted) {
      return buildWarning(state.reason);
    }

    for (const medication of medications) {
      for (const schedule of medication.schedules) {
        await this.scheduleForSchedule(medication, schedule);
      }
    }
    return null;
  }

  private async scheduleForSchedule(medication: Medication, schedule: MedicationSchedule): Promise<void> {
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const next = new Date();
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= Date.now()) {
      next.setDate(next.getDate() + 1);
    }

    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: next.getTime(),
    };

    await notifee.createTriggerNotification(
      {
        id: `${medication.id}-${schedule.id}`,
        title: 'Medication reminder',
        body: `Time to take ${medication.name}`,
        android: { channelId: REMINDER_CHANNEL_ID },
      },
      trigger,
    );
  }

  /**
   * Records a dose. Never silently records a future dose or duplicates a dose
   * caused by a clock jump; untrusted doses are queued for reconciliation.
   */
  async logDose(medicationId: string, scheduleId: string, takenAt?: number): Promise<DoseLogResult> {
    const state = await this.checkClock();
    const now = Date.now();
    const timestamp = takenAt ?? now;

    if (timestamp - now > FUTURE_DOSE_TOLERANCE_MS) {
      const warning = buildWarning('forward-jump');
      return { recorded: false, queued: false, warning };
    }

    const duplicate = this.pendingDoses.some(
      (dose) => dose.medicationId === medicationId && dose.scheduleId === scheduleId && Math.abs(dose.takenAt - timestamp) < CLOCK_JUMP_THRESHOLD_MS,
    );
    if (duplicate) {
      return { recorded: false, queued: false, warning: buildWarning(state.reason ?? 'backward-jump') };
    }

    const doseLog: DoseLog = {
      id: `${medicationId}-${scheduleId}-${timestamp}`,
      medicationId,
      scheduleId,
      takenAt: timestamp,
      synced: false,
    };

    if (!state.trusted) {
      this.pendingDoses.push(doseLog);
      await this.persistPendingDoses();
      return { recorded: false, queued: true, warning: buildWarning(state.reason), doseLog };
    }

    try {
      await apiClient.post('/doses', doseLog);
      doseLog.synced = true;
      return { recorded: true, queued: false, doseLog };
    } catch {
      this.pendingDoses.push(doseLog);
      await this.persistPendingDoses();
      return { recorded: false, queued: true, doseLog };
    }
  }

  /**
   * Reconciles queued doses using authoritative server timestamps.
   */
  async reconcilePendingDoses(): Promise<void> {
    if (this.pendingDoses.length === 0) {
      return;
    }

    let serverTime: number | null = null;
    try {
      const response = await apiClient.get('/time');
      serverTime = response?.data?.serverTime ?? null;
    } catch {
      return;
    }

    await this.checkClock(serverTime);

    const remaining: DoseLog[] = [];
    for (const dose of this.pendingDoses) {
      try {
        await apiClient.post('/doses', { ...dose, takenAt: serverTime ?? dose.takenAt });
      } catch {
        remaining.push(dose);
      }
    }

    this.pendingDoses = remaining;
    await this.persistPendingDoses();
  }
}

export const medicationReminderService = new MedicationReminderService();
export default medicationReminderService;
