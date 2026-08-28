/**
 * Widget Debug Utility
 *
 * Helper functions for testing and debugging the widget implementation
 * Use in development or debug screens to test widget functionality
 */

import { getUpcomingAppointments } from './appointmentService';
import { getHealthMetrics } from './healthMetricService';
import { getMedications } from './medicationService';
import petService from './petService';
import * as widgetService from './widgetService';

/**
 * Get detailed widget debug information
 */
export async function getWidgetDebugInfo() {
  try {
    const cachedData = await widgetService.getWidgetDataFromCache();
    const available = await widgetService.isWidgetAvailable();

    const [medications, pets] = await Promise.all([getMedications(), petService.getAllPets()]);

    return {
      widgetAvailable: available,
      cachedData,
      dataAge: cachedData ? Date.now() - cachedData.timestamp : null,
      medicationsCount: medications.length,
      petsCount: pets.length,
      appGroupConfigured: true, // This would need to be checked via native module
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Manually trigger widget refresh and log results
 */
export async function debugRefreshWidget() {
  console.log('[WidgetDebug] Starting widget refresh...');
  try {
    await widgetService.refreshWidgetData();
    console.log('[WidgetDebug] Widget refresh completed successfully');

    const cached = await widgetService.getWidgetDataFromCache();
    console.log('[WidgetDebug] Cached widget data:', cached);

    return {
      success: true,
      data: cached,
    };
  } catch (error) {
    console.error('[WidgetDebug] Widget refresh failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate mock widget data for testing
 */
export function generateMockWidgetData() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    medications: [
      {
        id: 'med1',
        medicationId: 'med1',
        medicationName: 'Amoxicillin',
        dosage: '500mg',
        petName: 'Max',
        petId: 'pet1',
        frequency: 8,
        taken: false,
      },
      {
        id: 'med2',
        medicationId: 'med2',
        medicationName: 'Flea Prevention',
        dosage: 'Topical',
        petName: 'Bella',
        petId: 'pet2',
        frequency: 168,
        taken: true,
      },
    ],
    appointments: [
      {
        id: 'apt1',
        title: 'Checkup',
        date: now.toISOString().split('T')[0],
        time: '10:00',
        petName: 'Max',
        petId: 'pet1',
        vetName: 'Dr. Smith',
        durationMinutes: 30,
      },
      {
        id: 'apt2',
        title: 'Vaccination',
        date: tomorrow.toISOString().split('T')[0],
        time: '14:30',
        petName: 'Bella',
        petId: 'pet2',
        vetName: 'Dr. Johnson',
        durationMinutes: 45,
      },
    ],
    healthScores: [
      {
        petId: 'pet1',
        petName: 'Max',
        petSpecies: 'dog',
        healthScore: 85,
        lastUpdated: now.toISOString(),
      },
      {
        petId: 'pet2',
        petName: 'Bella',
        petSpecies: 'cat',
        healthScore: 92,
        lastUpdated: now.toISOString(),
      },
    ],
    lastUpdated: now.toISOString(),
    timestamp: Date.now(),
  };
}

/**
 * Log widget deep link navigation
 */
export function debugHandleWidgetDeepLink(
  linkType: 'medication' | 'appointment' | 'health',
  targetId: string,
) {
  const result = widgetService.handleWidgetDeepLink(linkType, targetId);
  console.log(`[WidgetDebug] Deep link navigation: ${linkType} -> ${targetId}`, result);
  return result;
}

/**
 * Validate widget data structure
 */
export function validateWidgetData(data: any): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Widget data must be an object');
    return errors;
  }

  // Check required fields
  if (!Array.isArray(data.medications)) {
    errors.push('medications must be an array');
  }

  if (!Array.isArray(data.appointments)) {
    errors.push('appointments must be an array');
  }

  if (!Array.isArray(data.healthScores)) {
    errors.push('healthScores must be an array');
  }

  if (!data.lastUpdated || typeof data.lastUpdated !== 'string') {
    errors.push('lastUpdated must be a valid ISO string');
  }

  if (!Number.isInteger(data.timestamp)) {
    errors.push('timestamp must be an integer');
  }

  // Validate medication items
  data.medications?.forEach((med: any, index: number) => {
    if (!med.id) errors.push(`medications[${index}].id is required`);
    if (!med.medicationName) errors.push(`medications[${index}].medicationName is required`);
    if (typeof med.taken !== 'boolean') errors.push(`medications[${index}].taken must be boolean`);
  });

  // Validate appointment items
  data.appointments?.forEach((apt: any, index: number) => {
    if (!apt.id) errors.push(`appointments[${index}].id is required`);
    if (!apt.title) errors.push(`appointments[${index}].title is required`);
    if (!apt.date) errors.push(`appointments[${index}].date is required`);
  });

  // Validate health scores
  data.healthScores?.forEach((score: any, index: number) => {
    if (!score.petId) errors.push(`healthScores[${index}].petId is required`);
    if (!score.petName) errors.push(`healthScores[${index}].petName is required`);
    if (!Number.isInteger(score.healthScore) || score.healthScore < 0 || score.healthScore > 100) {
      errors.push(`healthScores[${index}].healthScore must be 0-100`);
    }
  });

  return errors;
}

/**
 * Print widget data in a readable format
 */
export function printWidgetData(data: any) {
  console.group('[WidgetDebug] Widget Data');

  console.log('Medications:');
  if (data.medications?.length > 0) {
    data.medications.forEach((med: any) => {
      console.log(
        `  - ${med.medicationName} (${med.dosage}) for ${med.petName} - ${med.taken ? '✓ Taken' : '○ Pending'}`,
      );
    });
  } else {
    console.log('  (none)');
  }

  console.log('Appointments:');
  if (data.appointments?.length > 0) {
    data.appointments.forEach((apt: any) => {
      console.log(`  - ${apt.title} for ${apt.petName} on ${apt.date} at ${apt.time}`);
    });
  } else {
    console.log('  (none)');
  }

  console.log('Health Scores:');
  if (data.healthScores?.length > 0) {
    data.healthScores.forEach((score: any) => {
      console.log(`  - ${score.petName}: ${score.healthScore}%`);
    });
  } else {
    console.log('  (none)');
  }

  console.log(`Last Updated: ${data.lastUpdated}`);
  console.log(`Timestamp: ${new Date(data.timestamp).toLocaleString()}`);

  console.groupEnd();
}

/**
 * Performance test: measure widget data fetch time
 */
export async function performanceTestWidgetFetch() {
  const startTime = performance.now();

  try {
    await widgetService.refreshWidgetData();
    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`[WidgetDebug] Widget data fetch took ${duration.toFixed(2)}ms`);

    return {
      success: true,
      duration,
    };
  } catch (error) {
    console.error('[WidgetDebug] Performance test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default {
  getWidgetDebugInfo,
  debugRefreshWidget,
  generateMockWidgetData,
  debugHandleWidgetDeepLink,
  validateWidgetData,
  printWidgetData,
  performanceTestWidgetFetch,
};
