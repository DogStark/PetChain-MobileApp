import { AppointmentStatus } from '../models/Appointment';
import { store } from '../server/store';
import {
  addMinutes,
  formatInTimezone,
  getCurrentDateInTimezone,
  parseZonedDateTime,
} from '../utils/dateUtils';

export interface TelemedicineAvailabilitySlot {
  date: string;
  time: string;
  display: string;
  startUtc: string;
  endUtc: string;
  timeZone: string;
}

const DAILY_START_HOUR = 8;
const DAILY_END_HOUR = 17;
const SLOT_INCREMENT_MINUTES = 30;
const DEFAULT_AVAILABILITY_DAYS = 3;

export function getVetAvailability(
  vetId: string,
  date: string,
  timeZone: string,
  days = DEFAULT_AVAILABILITY_DAYS,
): TelemedicineAvailabilitySlot[] {
  const zone = timeZone || 'UTC';
  const startDate = parseZonedDateTime(date || getCurrentDateInTimezone(zone), '00:00', zone);
  const now = new Date();

  const availability: TelemedicineAvailabilitySlot[] = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const currentDate = addMinutes(startDate, dayOffset * 24 * 60);
    const currentDateKey = formatInTimezone(
      currentDate,
      zone,
      {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      },
      'en-CA',
    );

    for (let hour = DAILY_START_HOUR; hour < DAILY_END_HOUR; hour += 1) {
      for (const minute of [0, SLOT_INCREMENT_MINUTES]) {
        const slotDateTime = parseZonedDateTime(
          currentDateKey,
          `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          zone,
        );

        if (slotDateTime <= now) continue;

        const isBooked = [...store.appointments.values()].some((appt) => {
          return (
            appt.vetId === vetId &&
            appt.status !== AppointmentStatus.CANCELLED &&
            appt.date === currentDateKey &&
            appt.time === `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` &&
            (appt.timeZone ?? 'UTC') === zone
          );
        });

        if (isBooked) continue;

        availability.push({
          date: currentDateKey,
          time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          display: formatInTimezone(slotDateTime, zone, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
          startUtc: slotDateTime.toISOString(),
          endUtc: addMinutes(slotDateTime, SLOT_INCREMENT_MINUTES).toISOString(),
          timeZone: zone,
        });
      }
    }
  }

  return availability;
}
