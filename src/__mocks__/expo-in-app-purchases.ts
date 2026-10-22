export enum IAPResponseCode {
  OK = 0,
  USER_CANCELLED = 1,
  DEFERRED = 2,
  ERROR = 3,
}

export enum IAPItemType {
  PURCHASE = 'inapp',
  SUBSCRIPTION = 'subs',
}

export const connectAsync = jest.fn().mockResolvedValue(undefined);
export const disconnectAsync = jest.fn().mockResolvedValue(undefined);
export const getProductsAsync = jest
  .fn()
  .mockResolvedValue({ responseCode: IAPResponseCode.OK, results: [] });
export const purchaseItemAsync = jest.fn().mockResolvedValue(undefined);
export const getPurchaseHistoryAsync = jest
  .fn()
  .mockResolvedValue({ responseCode: IAPResponseCode.OK, results: [] });
export const finishTransactionAsync = jest.fn().mockResolvedValue(undefined);
export const setPurchaseListener = jest.fn();
