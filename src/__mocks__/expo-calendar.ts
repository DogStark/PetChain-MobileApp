const EntityTypes = { EVENT: 'event' };
const CalendarAccessLevel = { OWNER: 'owner' };

module.exports = {
  EntityTypes,
  CalendarAccessLevel,
  requestCalendarPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCalendarsAsync: jest.fn().mockResolvedValue([]),
  createCalendarAsync: jest.fn().mockResolvedValue('cal-1'),
  createEventAsync: jest.fn().mockResolvedValue('evt-1'),
  updateEventAsync: jest.fn().mockResolvedValue(undefined),
  deleteEventAsync: jest.fn().mockResolvedValue(undefined),
};
