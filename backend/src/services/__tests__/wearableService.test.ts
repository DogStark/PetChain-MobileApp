import wearableService, { detectAnomaliesForPet } from '../../services/wearableService';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/services/notificationService', () => ({
  sendAlertNotification: jest.fn(),
}));

const { sendAlertNotification } = require('../../../src/services/notificationService');
const { query } = require('../../db');

describe('wearableService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('syncProviderForPet imports normalized metrics', async () => {
    // First query returns token record
    (query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [{ access_token: 'tok', pet_id: 'pet1', provider_key: 'mockfit' }],
      })
      // subsequent inserts resolve to empty
      .mockResolvedValue({ rows: [] });

    const res = await wearableService.syncProviderForPet('mockfit', 'pet1');
    expect(res.imported).toBeGreaterThan(0);
    // ensure inserts were attempted (at least once)
    expect((query as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('detectAnomaliesForPet triggers alert when recent << baseline', async () => {
    // baseline query
    (query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ baseline: '10000' }] })
      // recent query
      .mockResolvedValueOnce({ rows: [{ recent: '100' }] });

    const result = await detectAnomaliesForPet('pet1', { windowDays: 14, thresholdPct: 0.4 });
    expect(result).toHaveProperty('alerted', true);
    expect(sendAlertNotification).toHaveBeenCalled();
  });
});
