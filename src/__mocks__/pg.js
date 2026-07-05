/* eslint-env jest */
const Pool = jest.fn().mockImplementation(() => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  connect: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
}));

const Client = jest.fn().mockImplementation(() => ({
  connect: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue({ rows: [] }),
  end: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
}));

module.exports = { Pool, Client };
