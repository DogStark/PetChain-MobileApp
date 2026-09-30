/**
 * Clinic-timezone-safe appointment time handling (issue #960).
 *
 * A booked slot is defined by the clinic's wall-clock time in the clinic's IANA
 * timezone — e.g. "2026-03-08 09:00 America/New_York". The device's own timezone
 * (which can change with travel, or differ by DST offset) must never shift that
 * slot. To stay unambiguous over the wire we transport BOTH the absolute instant
 * (UTC ISO string) and the clinic zone, and validate that they agree.
 */

export interface ClinicAppointmentTime {
  /** Absolute instant of the appointment, UTC ISO-8601 with `Z`. */
  utc: string;
  /** IANA timezone of the clinic, e.g. "America/New_York". */
  clinicTimeZone: string;
  /** Clinic wall-clock date, `YYYY-MM-DD` in `clinicTimeZone`. */
  localDate: string;
  /** Clinic wall-clock time, `HH:mm` (24h) in `clinicTimeZone`. */
  localTime: string;
  /** Clinic UTC offset in minutes at that instant (captures DST). */
  clinicOffsetMinutes: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Assert an IANA timezone id is usable on this JS runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * UTC offset (minutes, east-positive) that `timeZone` was at on the given
 * instant. Correctly reflects DST because it is evaluated at that instant.
 */
export function getTimeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUTC - instant.getTime()) / 60000);
}

/**
 * Resolve a clinic wall-clock date + time in a clinic timezone to an absolute
 * instant, independent of the device timezone. Handles DST via a two-pass
 * offset resolution (the offset just before and just after the wall time can
 * differ across a DST boundary).
 */
export function clinicWallTimeToUTC(
  localDate: string,
  localTime: string,
  clinicTimeZone: string,
): Date {
  if (!DATE_RE.test(localDate)) throw new Error(`Invalid clinic date: ${localDate}`);
  if (!TIME_RE.test(localTime)) throw new Error(`Invalid clinic time: ${localTime}`);
  if (!isValidTimeZone(clinicTimeZone)) {
    throw new Error(`Invalid clinic timezone: ${clinicTimeZone}`);
  }

  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = localTime.split(':').map(Number);
  const naiveUTC = Date.UTC(y, m - 1, d, hh, mm, 0);

  // First guess with the offset at the naive instant, then re-check with the
  // offset at the corrected instant so DST transitions converge.
  let guess = new Date(
    naiveUTC - getTimeZoneOffsetMinutes(new Date(naiveUTC), clinicTimeZone) * 60000,
  );
  const secondOffset = getTimeZoneOffsetMinutes(guess, clinicTimeZone);
  guess = new Date(naiveUTC - secondOffset * 60000);
  return guess;
}

/** Format an instant as `YYYY-MM-DD` / `HH:mm` wall-clock in a timezone. */
export function formatInTimeZone(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/**
 * Build the wire payload for an appointment from the clinic's wall-clock slot.
 * The result carries UTC + clinic zone so the server and other devices resolve
 * the identical instant regardless of their local timezone.
 */
export function buildClinicAppointmentTime(
  localDate: string,
  localTime: string,
  clinicTimeZone: string,
): ClinicAppointmentTime {
  const instant = clinicWallTimeToUTC(localDate, localTime, clinicTimeZone);
  return {
    utc: instant.toISOString(),
    clinicTimeZone,
    localDate,
    localTime,
    clinicOffsetMinutes: getTimeZoneOffsetMinutes(instant, clinicTimeZone),
  };
}

export interface AppointmentTimeValidation {
  valid: boolean;
  /** Reasons the payload is inconsistent or unbookable. */
  errors: string[];
  /** True when the device timezone would have displayed a different day/time. */
  deviceTimeZoneWouldShift: boolean;
}

/**
 * Verify a {@link ClinicAppointmentTime} is internally consistent: the UTC
 * instant must map back to the stated clinic wall time, and the offset must
 * match. Also reports whether rendering with the device timezone would show a
 * different slot (the bug this guards against).
 */
export function validateClinicAppointmentTime(
  payload: ClinicAppointmentTime,
  deviceTimeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): AppointmentTimeValidation {
  const errors: string[] = [];

  const instant = new Date(payload.utc);
  if (Number.isNaN(instant.getTime())) errors.push('utc is not a valid ISO instant');
  if (!isValidTimeZone(payload.clinicTimeZone)) {
    errors.push(`clinicTimeZone "${payload.clinicTimeZone}" is not a valid IANA zone`);
  }

  let deviceTimeZoneWouldShift = false;
  if (errors.length === 0) {
    const clinicWall = formatInTimeZone(instant, payload.clinicTimeZone);
    if (clinicWall.date !== payload.localDate || clinicWall.time !== payload.localTime) {
      errors.push(
        `utc ${payload.utc} resolves to ${clinicWall.date} ${clinicWall.time} in ` +
          `${payload.clinicTimeZone}, not the stated ${payload.localDate} ${payload.localTime}`,
      );
    }
    const actualOffset = getTimeZoneOffsetMinutes(instant, payload.clinicTimeZone);
    if (actualOffset !== payload.clinicOffsetMinutes) {
      errors.push(
        `clinicOffsetMinutes ${payload.clinicOffsetMinutes} does not match actual ${actualOffset}`,
      );
    }
    if (isValidTimeZone(deviceTimeZone)) {
      const deviceWall = formatInTimeZone(instant, deviceTimeZone);
      deviceTimeZoneWouldShift =
        deviceWall.date !== payload.localDate || deviceWall.time !== payload.localTime;
    }
  }

  return { valid: errors.length === 0, errors, deviceTimeZoneWouldShift };
}
