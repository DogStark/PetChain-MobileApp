export const getCurrentPosition = jest.fn((success) =>
  success({ coords: { latitude: 0, longitude: 0, accuracy: 10 } }),
);
export const watchPosition = jest.fn(() => 1);
export const clearWatch = jest.fn();
export const stopObserving = jest.fn();

export default {
  getCurrentPosition,
  watchPosition,
  clearWatch,
  stopObserving,
};
