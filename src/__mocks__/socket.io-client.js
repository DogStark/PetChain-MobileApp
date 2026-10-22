/* eslint-env jest */
const io = jest.fn().mockReturnValue({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
module.exports = io;
module.exports.io = io;
