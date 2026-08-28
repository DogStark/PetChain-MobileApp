/* eslint-env jest */
const noop = (req, res, next) => next();
const multer = jest.fn().mockReturnValue({
  single: jest.fn().mockReturnValue(noop),
  array: jest.fn().mockReturnValue(noop),
});
multer.memoryStorage = jest.fn();
module.exports = multer;
