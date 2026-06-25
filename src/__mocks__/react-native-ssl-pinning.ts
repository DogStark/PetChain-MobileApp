export const fetch = jest.fn(() =>
  Promise.resolve({ status: 200, json: () => Promise.resolve({}) }),
);
