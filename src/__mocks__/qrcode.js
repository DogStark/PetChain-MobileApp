const QRCode = {
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockqr'),
  toString: jest.fn().mockResolvedValue('<svg>mock</svg>'),
};
module.exports = QRCode;
