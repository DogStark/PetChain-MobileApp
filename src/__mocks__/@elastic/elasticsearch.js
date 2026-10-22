/* eslint-env jest */
const Client = jest.fn().mockImplementation(() => ({
  search: jest.fn().mockResolvedValue({ hits: { hits: [] } }),
  index: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
}));
module.exports = { Client };
