import { Camera } from 'expo-camera';
import { useCallback, useRef, useState } from 'react';

import { scanQRCode, type QRScanResult } from '../services/qrCodeService';

type ScanEvent = string | { data?: string };

export interface UseQRScannerResult {
  isScanning: boolean;
  startScan: () => Promise<boolean>;
  stopScan: () => void;
  handleScan: (event: ScanEvent) => Promise<QRScanResult | null>;
  result: QRScanResult | null;
  error: string | null;
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function useQRScanner(debounceMs = DEFAULT_DEBOUNCE_MS): UseQRScannerResult {
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<QRScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastScanRef = useRef<{ data: string; scannedAt: number } | null>(null);

  const startScan = useCallback(async (): Promise<boolean> => {
    setError(null);

    const permission = await Camera.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setIsScanning(false);
      setError('Camera permission denied');
      return false;
    }

    setIsScanning(true);
    return true;
  }, []);

  const stopScan = useCallback((): void => {
    setIsScanning(false);
  }, []);

  const handleScan = useCallback(
    async (event: ScanEvent): Promise<QRScanResult | null> => {
      const data = typeof event === 'string' ? event : event.data;
      if (!data || !isScanning) return null;

      const now = Date.now();
      const lastScan = lastScanRef.current;
      if (lastScan?.data === data && now - lastScan.scannedAt < debounceMs) {
        return result;
      }

      lastScanRef.current = { data, scannedAt: now };
      setError(null);

      const scanResult = await scanQRCode(data);
      setResult(scanResult);

      if (!scanResult.valid) {
        setError(scanResult.error ?? 'Invalid QR code');
      }

      return scanResult;
    },
    [debounceMs, isScanning, result],
  );

  return {
    isScanning,
    startScan,
    stopScan,
    handleScan,
    result,
    error,
  };
}

export default useQRScanner;
