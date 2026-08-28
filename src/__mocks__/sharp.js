/* eslint-env jest */
const sharp = jest.fn().mockReturnValue({
  resize: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('')),
  toFile: jest.fn().mockResolvedValue({}),
});
module.exports = sharp;
