import { Camera } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const mountedRef = useRef(true);
  const activeRef = useRef(true);
  const scanIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      // Invalidate any in-flight decode work so late results are ignored.
      scanIdRef.current += 1;
    };
  }, []);

  const startScan = useCallback(async (): Promise<boolean> => {
    setError(null);

    const permission = await Camera.requestCameraPermissionsAsync();
    if (!mountedRef.current) return false;
    if (!permission.granted) {
      setIsScanning(false);
      setError('Camera permission denied');
      return false;
    }

    activeRef.current = true;
    setIsScanning(true);
    return true;
  }, []);

  const stopScan = useCallback((): void => {
    activeRef.current = false;
    // Cancel pending decode work so a late result cannot navigate.
    scanIdRef.current += 1;
    setIsScanning(false);
  }, []);

  const handleScan = useCallback(
    async (event: ScanEvent): Promise<QRScanResult | null> => {
      const data = typeof event === 'string' ? event : event.data;
      if (!data || !isScanning) return null;
      if (!mountedRef.current || !activeRef.current) return null;

      const now = Date.now();
      const lastScan = lastScanRef.current;
      if (lastScan?.data === data && now - lastScan.scannedAt < debounceMs) {
        return result;
      }

      lastScanRef.current = { data, scannedAt: now };
      setError(null);

      const scanId = scanIdRef.current + 1;
      scanIdRef.current = scanId;

      const scanResult = await scanQRCode(data);

      // Ignore results that arrive after unmount, stop, or a newer scan.
      if (!mountedRef.current || !activeRef.current) return null;
      if (scanIdRef.current !== scanId) return null;

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
