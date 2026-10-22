export const BarCodeScanner = {
  requestPermissionsAsync: jest.fn(),
  Constants: {
    BarCodeType: {
      qr: 'qr',
      pdf417: 'pdf417',
      datamatrix: 'datamatrix',
      aztec: 'aztec',
      ean13: 'ean13',
      ean8: 'ean8',
      code39: 'code39',
      code93: 'code93',
      code128: 'code128',
      code39mod43: 'code39mod43',
      upc_e: 'upc_e',
      interleaved2of5: 'interleaved2of5',
      itf14: 'itf14',
    },
  },
};

export interface BarCodeScannerResult {
  type: string;
  data: string;
}

export default BarCodeScanner;
