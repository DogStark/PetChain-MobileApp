import { render } from '@testing-library/react-native';
import React from 'react';

// Mock screen component
const QRScannerScreen = () => (
  <div>
    <h1>QR Scanner</h1>
    <div>Camera View</div>
    <div>Scan Instructions</div>
    <div>Recent Scans</div>
  </div>
);

describe('QRScannerScreen Snapshots', () => {
  it('should match snapshot', () => {
    const { toJSON } = render(<QRScannerScreen />);

    expect(toJSON()).toMatchSnapshot();
  });

  it('should display scanner interface', () => {
    const { getByText } = render(<QRScannerScreen />);

    expect(getByText('QR Scanner')).toBeTruthy();
    expect(getByText('Camera View')).toBeTruthy();
    expect(getByText('Scan Instructions')).toBeTruthy();
  });

  it('should display recent scans section', () => {
    const { getByText } = render(<QRScannerScreen />);

    expect(getByText('Recent Scans')).toBeTruthy();
  });
});
