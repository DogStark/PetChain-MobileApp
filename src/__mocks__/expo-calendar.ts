const EntityTypes = { EVENT: 'event' };
const CalendarAccessLevel = { OWNER: 'owner' };

module.exports = {
  EntityTypes,
  CalendarAccessLevel,
  requestCalendarPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCalendarPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCalendarsAsync: jest.fn().mockResolvedValue([]),
  createCalendarAsync: jest.fn().mockResolvedValue('cal-1'),
  createEventAsync: jest.fn().mockResolvedValue('evt-1'),
  updateEventAsync: jest.fn().mockResolvedValue(undefined),
  deleteEventAsync: jest.fn().mockResolvedValue(undefined),
  // Issue #1186: stale-record detection reads the event back before updating it.
  getEventAsync: jest.fn().mockResolvedValue({ id: 'evt-1', title: 'Vet appointment' }),
  // Issue #1186: duplicate detection scans a calendar for events in a date window.
  getEventsAsync: jest.fn().mockResolvedValue([]),
};
