/* eslint-env jest */
const Server = jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  emit: jest.fn(),
  to: jest.fn().mockReturnThis(),
}));
module.exports = { Server };
