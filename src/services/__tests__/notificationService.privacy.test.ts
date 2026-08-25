import * as Notifications from 'expo-notifications';
import { getPreferences, savePreferences, getPrivateNotificationContent } from '../notificationService';

jest.mock('expo-notifications');
jest.mock('../localDB');

describe('#920 — Lock-screen notification privacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use generic copy for medication reminders when privacy is enabled', async () => {
    await savePreferences({ privacySettings: { medicationDetailsPrivate: true } });
    const content = getPrivateNotificationContent('medication', {
      title: '💊 Medication Reminder',
      body: 'Time to give Amoxicillin (500mg)',
    });
    expect(content.title).toBe('💊 Reminder');
    expect(content.body).toBe('You have a reminder');
  });

  it('should use detailed copy when privacy is disabled', async () => {
    await savePreferences({ privacySettings: { medicationDetailsPrivate: false } });
    const content = getPrivateNotificationContent('medication', {
      title: '💊 Medication Reminder',
      body: 'Time to give Amoxicillin (500mg)',
    });
    expect(content.title).toBe('💊 Medication Reminder');
    expect(content.body).toContain('Amoxicillin');
  });

  it('should use generic copy for appointment reminders when privacy is enabled', async () => {
    await savePreferences({ privacySettings: { appointmentDetailsPrivate: true } });
    const content = getPrivateNotificationContent('appointment', {
      title: 'Appointment Reminder',
      body: 'Vet appointment at Sunny Pet Clinic',
    });
    expect(content.body).toBe('You have a reminder');
  });

  it('should use generic copy for vaccination reminders when privacy is enabled', async () => {
    await savePreferences({ privacySettings: { vaccinationDetailsPrivate: true } });
    const content = getPrivateNotificationContent('vaccination', {
      title: 'Vaccination Alert',
      body: 'Rabies vaccine due for Fluffy',
    });
    expect(content.body).toBe('You have a reminder');
  });

  it('should default to private (generic) copy for all health categories', async () => {
    const prefs = await getPreferences();
    expect(prefs.privacySettings.medicationDetailsPrivate).toBe(true);
    expect(prefs.privacySettings.appointmentDetailsPrivate).toBe(true);
    expect(prefs.privacySettings.vaccinationDetailsPrivate).toBe(true);
  });
});
