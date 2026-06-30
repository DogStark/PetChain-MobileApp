export const reloadAsync = jest.fn();
export const checkForUpdateAsync = jest.fn(() => Promise.resolve({ isAvailable: false }));
export const fetchUpdateAsync = jest.fn();

export default {
  reloadAsync,
  checkForUpdateAsync,
  fetchUpdateAsync,
};
