import { getVetAvailability } from '../telemedicineService';

describe('telemedicineService', () => {
  it('should return availability slots for a vet with a valid timezone', () => {
    const slots = getVetAvailability('vet-demo-id', '2026-06-01', 'America/New_York', 1);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toEqual(
      expect.objectContaining({
        date: '2026-06-01',
        timeZone: 'America/New_York',
        display: expect.any(String),
        startUtc: expect.any(String),
      }),
    );
  });

  it('should omit slots that are already booked for a vet', () => {
    const mockSlot = getVetAvailability('vet-demo-id', '2026-06-01', 'UTC', 1);
    expect(mockSlot.every((slot) => slot.timeZone === 'UTC')).toBe(true);
  });
});
