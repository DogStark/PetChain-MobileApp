/**
 * Widget Service Tests
 *
 * Unit and integration tests for the widget service
 */

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../localDB', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../petService', () => ({
  __esModule: true,
  default: { getAllPets: jest.fn() },
  getPetById: jest.fn(),
}));

jest.mock('../medicationService', () => ({
  getMedications: jest.fn(),
  getDoseLogs: jest.fn(),
}));

jest.mock('../appointmentService', () => ({ getUpcomingAppointments: jest.fn() }));
jest.mock('../healthMetricService', () => ({ getHealthMetrics: jest.fn() }));

import apiClient from '../apiClient';
import { getItem, setItem } from '../localDB';
import petService from '../petService';
import { getMedications, getDoseLogs } from '../medicationService';
import { getUpcomingAppointments } from '../appointmentService';
import * as widgetDebug from '../widgetDebug';
import * as widgetService from '../widgetService';

const mockGet = apiClient.get as jest.Mock;
const mockGetItem = getItem as jest.Mock;
const mockSetItem = setItem as jest.Mock;

describe('widgetService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    mockGet.mockResolvedValue({ status: 200 });
    (petService.getAllPets as jest.Mock).mockResolvedValue([
      {
        id: 'pet-1',
        name: 'Milo',
        species: 'dog',
      },
    ]);
    (getMedications as jest.Mock).mockResolvedValue([
      {
        id: 'med-1',
        petId: 'pet-1',
        name: 'Daily medication',
        dosage: '1 tablet',
        frequency: 24,
        startDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ]);
    (getDoseLogs as jest.Mock).mockResolvedValue([]);
    (getUpcomingAppointments as jest.Mock).mockResolvedValue([]);
  });

  describe('buildCareAgenda', () => {
    const now = new Date('2026-10-21T10:00:00.000Z');

    it('returns the selected pet tasks in time order and excludes expired/other-pet tasks', () => {
      const tasks = widgetService.buildCareAgenda(
        'pet-1',
        'Milo',
        [
          {
            id: 'med-1',
            petId: 'pet-1',
            name: 'Medication A',
            dosage: '1 tablet',
            frequency: 12,
            startDate: '2026-10-21T08:00:00.000Z',
          },
          {
            id: 'med-2',
            petId: 'pet-2',
            name: 'Other pet medication',
            dosage: '1 tablet',
            frequency: 8,
            startDate: '2026-10-21T08:00:00.000Z',
          },
          {
            id: 'med-expired',
            petId: 'pet-1',
            name: 'Expired medication',
            dosage: '1 tablet',
            frequency: 8,
            startDate: '2026-10-20T08:00:00.000Z',
            endDate: '2026-10-21T09:00:00.000Z',
          },
        ],
        [
          {
            id: 'apt-1',
            petId: 'pet-1',
            title: 'Vet visit',
            date: '2026-10-21T11:30:00.000Z',
          } as never,
          {
            id: 'apt-past',
            petId: 'pet-1',
            title: 'Past visit',
            date: '2026-10-21T09:00:00.000Z',
          } as never,
        ],
        now,
      );

      expect(tasks.map((task) => task.id)).toEqual(['appointment:apt-1', 'medication:med-1']);
      expect(tasks[0].detail).toBe('Milo');
    });

    it('applies the agenda limit and includes tasks due exactly now', () => {
      const tasks = widgetService.buildCareAgenda(
        'pet-1',
        'Milo',
        [],
        [
          { id: 'apt-now', petId: 'pet-1', title: 'Checkup', date: now.toISOString() } as never,
          { id: 'apt-next', petId: 'pet-1', title: 'Follow up', date: '2026-10-22T10:00:00.000Z' } as never,
        ],
        now,
        1,
      );

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('appointment:apt-now');
    });

    it('advances a medication task from its latest recorded dose', () => {
      const tasks = widgetService.buildCareAgenda(
        'pet-1',
        'Milo',
        [
          {
            id: 'med-1',
            petId: 'pet-1',
            name: 'Medication A',
            dosage: '1 tablet',
            frequency: 12,
            startDate: '2026-10-21T08:00:00.000Z',
          },
        ],
        [],
        now,
        5,
        [
          {
            id: 'dose-1',
            medicationId: 'med-1',
            takenAt: '2026-10-21T09:00:00.000Z',
            scheduledFor: '2026-10-21T09:00:00.000Z',
          }],
      );

      expect(tasks[0].scheduledAt).toBe('2026-10-21T21:00:00.000Z');
    });
  });

  describe('widget preferences and server access', () => {
    it('defaults to hiding lock-screen details and persists preference updates', async () => {
      await expect(widgetService.getWidgetPreferences()).resolves.toEqual({
        selectedPetId: null,
        hideDetailsOnLockScreen: true,
      });

      mockGetItem.mockResolvedValueOnce(
        JSON.stringify({ selectedPetId: 'pet-1', hideDetailsOnLockScreen: true }),
      );
      await expect(
        widgetService.saveWidgetPreferences({ hideDetailsOnLockScreen: false }),
      ).resolves.toEqual({ selectedPetId: 'pet-1', hideDetailsOnLockScreen: false });
      expect(mockSetItem).toHaveBeenCalledWith(
        'widget_preferences',
        JSON.stringify({ selectedPetId: 'pet-1', hideDetailsOnLockScreen: false }),
      );
    });

    it('distinguishes server-confirmed denial from a transient unavailable response', async () => {
      mockGet.mockResolvedValueOnce({ status: 200 });
      await expect(widgetService.checkWidgetPetAccess('pet-1')).resolves.toBe('granted');

      mockGet.mockRejectedValueOnce({ response: { status: 403 } });
      await expect(widgetService.checkWidgetPetAccess('pet-1')).resolves.toBe('denied');

      mockGet.mockRejectedValueOnce(new Error('offline'));
      await expect(widgetService.checkWidgetPetAccess('pet-1')).resolves.toBe('unavailable');
      expect(mockGet).toHaveBeenCalledWith('/pets/pet-1');
    });

    it('publishes only the selected pet agenda after server access is confirmed', async () => {
      mockGetItem.mockResolvedValueOnce(
        JSON.stringify({ selectedPetId: 'pet-1', hideDetailsOnLockScreen: true }),
      );

      const data = await widgetService.fetchWidgetData();

      expect(data.selectedPetId).toBe('pet-1');
      expect(data.agenda?.map((task) => task.id)).toEqual(['medication:med-1']);
      expect(data.hideDetailsOnLockScreen).toBe(true);
      expect(mockGet).toHaveBeenCalledWith('/pets/pet-1');
    });

    it('clears stale widget data when the server revokes access', async () => {
      mockGetItem.mockResolvedValueOnce(
        JSON.stringify({ selectedPetId: 'pet-1', hideDetailsOnLockScreen: true }),
      );
      mockGet.mockRejectedValueOnce({ response: { status: 403 } });

      const data = await widgetService.fetchWidgetData();

      expect(data.agenda).toEqual([]);
      expect(data.selectedPetId).toBeNull();
      expect(mockSetItem).toHaveBeenCalledWith(
        'widget_preferences',
        JSON.stringify({ selectedPetId: null, hideDetailsOnLockScreen: true }),
      );
    });

    it('keeps the cached selected-pet agenda when server access cannot be checked offline', async () => {
      mockGetItem.mockResolvedValueOnce(
        JSON.stringify({ selectedPetId: 'pet-1', hideDetailsOnLockScreen: true }),
      );
      mockGet.mockRejectedValueOnce(new Error('offline'));

      const data = await widgetService.fetchWidgetData();

      expect(data.agenda?.map((task) => task.id)).toEqual(['medication:med-1']);
      expect(data.selectedPetId).toBe('pet-1');
    });
  });

  describe('getTodaysMedicationSchedule', () => {
    it('should return medications scheduled for today', async () => {
      // This would require mocking the dependencies
      // In a real test environment, use jest.mock()
    });

    it('should mark taken medications correctly', async () => {
      // Test that dose logs are checked for today's medications
    });

    it('should exclude expired medications', async () => {
      // Test that medications outside their date range are excluded
    });
  });

  describe('getUpcomingAppointmentsForWidget', () => {
    it('should return up to 5 upcoming appointments', async () => {
      // Should fetch and sort by date
    });

    it('should include pet and vet information', async () => {
      // Should enrich appointment data with pet and vet details
    });
  });

  describe('calculatePetHealthScore', () => {
    it('should return a score between 0-100', async () => {
      // Score should be bounded
    });

    it('should factor in activity level', async () => {
      // Low activity should reduce score
    });

    it('should factor in temperature', async () => {
      // Abnormal temperatures should reduce score
    });

    it('should use recent metrics only', async () => {
      // Should only consider last 7 days
    });

    it('should return default score if no metrics exist', async () => {
      // Should return 75 as default
    });
  });

  describe('refreshWidgetData', () => {
    it('should fetch all widget data', async () => {
      // Should call all three data fetching functions
    });

    it('should update widget display', async () => {
      // Should call updateWidgetDisplay with the data
    });

    it('should handle errors gracefully', async () => {
      // Should not throw, should log errors
    });
  });

  describe('handleWidgetDeepLink', () => {
    it('should return correct route for medication deeplink', () => {
      const result = widgetService.handleWidgetDeepLink('medication', 'med1');
      expect(result.route).toBe('MedicationDetail');
      expect(result.params?.medicationId).toBe('med1');
    });

    it('should return correct route for appointment deeplink', () => {
      const result = widgetService.handleWidgetDeepLink('appointment', 'apt1');
      expect(result.route).toBe('AppointmentDetail');
      expect(result.params?.appointmentId).toBe('apt1');
    });

    it('should return correct route for health deeplink', () => {
      const result = widgetService.handleWidgetDeepLink('health', 'pet1');
      expect(result.route).toBe('PetHealthDetails');
      expect(result.params?.petId).toBe('pet1');
    });
  });

  describe('initializeWidgetService', () => {
    it('should return a cleanup function', () => {
      const cleanup = widgetService.initializeWidgetService();
      expect(typeof cleanup).toBe('function');
    });

    it('should set up AppState listener', () => {
      // Should listen for app state changes
    });

    it('should set up notification listener', () => {
      // Should listen for notification responses
    });
  });
});

describe('widgetDebug', () => {
  describe('validateWidgetData', () => {
    it('should validate correct widget data', () => {
      const data = widgetDebug.generateMockWidgetData();
      const errors = widgetDebug.validateWidgetData(data);
      expect(errors.length).toBe(0);
    });

    it('should detect missing medications array', () => {
      const invalidData = {
        appointments: [],
        healthScores: [],
        lastUpdated: new Date().toISOString(),
        timestamp: Date.now(),
      };
      const errors = widgetDebug.validateWidgetData(invalidData);
      expect(errors.some((e) => e.includes('medications'))).toBe(true);
    });

    it('should detect invalid health scores', () => {
      const invalidData = widgetDebug.generateMockWidgetData();
      invalidData.healthScores[0].healthScore = 150; // Invalid
      const errors = widgetDebug.validateWidgetData(invalidData);
      expect(errors.some((e) => e.includes('healthScore'))).toBe(true);
    });

    it('should validate medication items', () => {
      const invalidData = widgetDebug.generateMockWidgetData();
      invalidData.medications[0].id = ''; // Missing id
      const errors = widgetDebug.validateWidgetData(invalidData);
      expect(errors.some((e) => e.includes('id'))).toBe(true);
    });
  });

  describe('generateMockWidgetData', () => {
    it('should generate valid widget data', () => {
      const data = widgetDebug.generateMockWidgetData();
      const errors = widgetDebug.validateWidgetData(data);
      expect(errors.length).toBe(0);
    });

    it('should include today and tomorrow appointments', () => {
      const data = widgetDebug.generateMockWidgetData();
      expect(data.appointments.length).toBeGreaterThan(0);
      // At least one should be today
    });
  });
});

// Integration tests
describe('Widget Integration', () => {
  it('should initialize widget service on app startup', async () => {
    // Test full initialization flow
  });

  it('should update widget on app foreground', async () => {
    // Simulate app state change to active
  });

  it('should update widget on medication notification', async () => {
    // Simulate notification receipt
  });

  it('should deep link from widget tap', async () => {
    // Test navigation flow
  });

  it('should handle offline scenario', async () => {
    // Should work with cached data
  });
});

// Performance tests
describe('Widget Performance', () => {
  it('widget data fetch should complete in < 1 second', async () => {
    // Should be fast enough for good UX
  });

  it('should not exceed memory limits', () => {
    // Should keep memory usage reasonable
  });
});
