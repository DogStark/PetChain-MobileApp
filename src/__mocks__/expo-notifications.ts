export const scheduleNotificationAsync = jest.fn().mockResolvedValue('notification-id');
export const cancelNotificationAsync = jest.fn().mockResolvedValue(undefined);
export const cancelAllScheduledNotificationsAsync = jest.fn().mockResolvedValue(undefined);
export const getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const getExpoPushTokenAsync = jest
  .fn()
  .mockResolvedValue({ data: 'ExponentPushToken[mock]' });
export const addNotificationReceivedListener = jest.fn(() => ({ remove: jest.fn() }));
export const addNotificationResponseReceivedListener = jest.fn(() => ({ remove: jest.fn() }));
export const removeNotificationSubscription = jest.fn();
export const AndroidImportance = { HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 };
