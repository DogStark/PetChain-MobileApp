const BackgroundFetch = {
  BackgroundFetchResult: {
    NewData: 'newData',
    NoData: 'noData',
    Failed: 'failed',
  },
  registerTaskAsync: jest.fn().mockResolvedValue(undefined),
  unregisterTaskAsync: jest.fn().mockResolvedValue(undefined),
};

export default BackgroundFetch;
export const { BackgroundFetchResult, registerTaskAsync, unregisterTaskAsync } = BackgroundFetch;
