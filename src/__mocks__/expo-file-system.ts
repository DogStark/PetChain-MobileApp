export const documentDirectory = '/mock/documents/';
export const cacheDirectory = '/mock/cache/';
export const EncodingType = { UTF8: 'utf8', Base64: 'base64' };
export const writeAsStringAsync = jest.fn().mockResolvedValue(undefined);
export const readAsStringAsync = jest.fn().mockResolvedValue('bW9ja2ZpbGVjb250ZW50');
export const deleteAsync = jest.fn().mockResolvedValue(undefined);
export const getInfoAsync = jest
  .fn()
  .mockResolvedValue({ exists: true, isDirectory: false, size: 1024 });
export const getFreeDiskStorageAsync = jest.fn().mockResolvedValue(100 * 1024 * 1024); // 100 MB free
