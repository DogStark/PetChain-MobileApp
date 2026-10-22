import { useMemo } from 'react';

import { type VetClinic } from '../services/mapService';

export type ClinicStatus = 'open' | 'closing_soon' | 'closed' | 'emergency';

/**
 * Pure function to calculate clinic status based on its schedule and a reference date.
 * Separated from the hook to allow robust unit testing with mock dates.
 */
export function calculateClinicStatus(
  clinic: VetClinic,
  referenceDate: Date = new Date(),
): ClinicStatus {
  if (clinic.available24h) {
    return 'emergency';
  }

  if (!clinic.schedule) {
    return 'closed';
  }

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDay = days[referenceDate.getDay()];
  const todaySchedule = clinic.schedule[currentDay];

  if (!todaySchedule) {
    return 'closed';
  }

  const { open, close } = todaySchedule;

  // Helper to parse "HH:MM" into minutes since midnight
  const parseTimeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const currentMinutes = referenceDate.getHours() * 60 + referenceDate.getMinutes();
  const openMinutes = parseTimeToMinutes(open);
  const closeMinutes = parseTimeToMinutes(close);

  let isOpen = false;
  let minutesToClose = 0;

  if (closeMinutes > openMinutes) {
    // Normal daytime schedule (e.g. 08:00 - 18:00)
    if (currentMinutes >= openMinutes && currentMinutes < closeMinutes) {
      isOpen = true;
      minutesToClose = closeMinutes - currentMinutes;
    }
  } else {
    // Overnight schedule (e.g. 18:00 - 02:00 next day)
    if (currentMinutes >= openMinutes || currentMinutes < closeMinutes) {
      isOpen = true;
      if (currentMinutes >= openMinutes) {
        minutesToClose = 24 * 60 - currentMinutes + closeMinutes;
      } else {
        minutesToClose = closeMinutes - currentMinutes;
      }
    }
  }

  if (!isOpen) {
    return 'closed';
  }

  if (minutesToClose <= 60) {
    return 'closing_soon';
  }

  return 'open';
}

/**
 * React Hook to dynamically compute a clinic's operational status.
 */
export function useClinicStatus(clinic: VetClinic, referenceDate: Date = new Date()): ClinicStatus {
  return useMemo(() => {
    return calculateClinicStatus(clinic, referenceDate);
  }, [clinic, referenceDate]);
}
export default useClinicStatus;
