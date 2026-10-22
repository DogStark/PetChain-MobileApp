import * as IAP from 'expo-in-app-purchases';

import apiClient from '../../services/apiClient';
import subscriptionService, {
  PRODUCT_IDS,
  FREE_PET_LIMIT,
} from '../../services/subscriptionService';

jest.mock('expo-in-app-purchases');
jest.mock('../../services/apiClient');

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('subscriptionService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('FREE_PET_LIMIT is 1', () => {
    expect(FREE_PET_LIMIT).toBe(1);
  });

  describe('fetchBackendStatus', () => {
    it('returns free status when no active subscription', async () => {
      mockApiClient.get = jest.fn().mockResolvedValue({ data: { success: true, data: null } });
      const status = await subscriptionService.fetchBackendStatus();
      expect(status.isPremium).toBe(false);
      expect(status.plan).toBe('free');
    });

    it('returns premium status for active subscription', async () => {
      mockApiClient.get = jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            status: 'active',
            plan: 'premium_monthly',
            currentPeriodEnd: '2026-06-29T00:00:00.000Z',
          },
        },
      });
      const status = await subscriptionService.fetchBackendStatus();
      expect(status.isPremium).toBe(true);
      expect(status.plan).toBe('premium_monthly');
    });

    it('returns free status on network error', async () => {
      mockApiClient.get = jest.fn().mockRejectedValue(new Error('Network error'));
      const status = await subscriptionService.fetchBackendStatus();
      expect(status.isPremium).toBe(false);
    });
  });

  describe('getProducts', () => {
    it('returns products on success', async () => {
      const mockProducts = [
        { productId: PRODUCT_IDS.monthly, price: '$9.99' },
        { productId: PRODUCT_IDS.annual, price: '$95.88' },
      ];
      (IAP.connectAsync as jest.Mock).mockResolvedValue(undefined);
      (IAP.getProductsAsync as jest.Mock).mockResolvedValue({
        responseCode: IAP.IAPResponseCode.OK,
        results: mockProducts,
      });
      const products = await subscriptionService.getProducts();
      expect(products).toHaveLength(2);
      expect(IAP.connectAsync).toHaveBeenCalled();
    });

    it('returns empty array on IAP error', async () => {
      (IAP.connectAsync as jest.Mock).mockResolvedValue(undefined);
      (IAP.getProductsAsync as jest.Mock).mockResolvedValue({
        responseCode: IAP.IAPResponseCode.ERROR,
        results: [],
      });
      const products = await subscriptionService.getProducts();
      expect(products).toHaveLength(0);
    });
  });

  describe('restorePurchases', () => {
    it('falls back to backend status when no purchase history', async () => {
      (IAP.connectAsync as jest.Mock).mockResolvedValue(undefined);
      (IAP.getPurchaseHistoryAsync as jest.Mock).mockResolvedValue({
        responseCode: IAP.IAPResponseCode.OK,
        results: [],
      });
      mockApiClient.get = jest.fn().mockResolvedValue({ data: { success: true, data: null } });
      const status = await subscriptionService.restorePurchases();
      expect(status.isPremium).toBe(false);
    });

    it('syncs with backend when purchase history exists', async () => {
      (IAP.connectAsync as jest.Mock).mockResolvedValue(undefined);
      (IAP.getPurchaseHistoryAsync as jest.Mock).mockResolvedValue({
        responseCode: IAP.IAPResponseCode.OK,
        results: [{ productId: PRODUCT_IDS.monthly, transactionId: 'txn_123' }],
      });
      mockApiClient.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { success: true, data: { id: 'pay_1' } } })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              subscription: {
                plan: 'premium_monthly',
                status: 'active',
                currentPeriodEnd: '2026-06-29T00:00:00.000Z',
              },
            },
          },
        });
      const status = await subscriptionService.restorePurchases();
      expect(status.isPremium).toBe(true);
      expect(status.plan).toBe('premium_monthly');
    });
  });
});
