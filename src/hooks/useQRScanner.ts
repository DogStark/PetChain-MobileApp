import { Camera } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { scanQRCode, type QRScanResult } from '../services/qrCodeService';

type ScanEvent = string | { data?: string };

export interface UseQRScannerResult {
  isScanning: boolean;
  startScan: () => Promise<boolean>;
  stopScan: () => void;
  handleScan: (event: ScanEvent) => Promise<QRScanResult | null>;
  result: QRScanResult | null;
  error: string | null;
  permissionDenied: boolean;
  torchSupported: boolean;
  torchEnabled: boolean;
  toggleTorch: () => void;
  submitManualCode: (code: string) => Promise<QRScanResult | null>;
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function useQRScanner(debounceMs = DEFAULT_DEBOUNCE_MS): UseQRScannerResult {
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<QRScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const lastScanRef = useRef<{ data: string; scannedAt: number } | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const startScan = useCallback(async (): Promise<boolean> => {
    setError(null);

    const permission = await Camera.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setIsScanning(false);
      setPermissionDenied(true);
      setError('Camera permission denied');
      return false;
    }

    setPermissionDenied(false);
    setIsScanning(true);
    return true;
  }, []);

  const stopScan = useCallback((): void => {
    setIsScanning(false);
    setTorchEnabled(false);
  }, []);

  const toggleTorch = useCallback((): void => {
    if (!torchSupported) return;
    setTorchEnabled((prev) => !prev);
  }, [torchSupported]);

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

  const submitManualCode = useCallback(
    async (code: string): Promise<QRScanResult | null> => {
      const data = code.trim();
      if (!data) return null;

      setError(null);
      const scanResult = await scanQRCode(data);
      setResult(scanResult);

      if (!scanResult.valid) {
        setError(scanResult.error ?? 'Invalid QR code');
      }

      return scanResult;
    },
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      const wasActive = previousState === 'active';
      const isActive = nextState === 'active';

      if (wasActive && !isActive) {
        setIsScanning(false);
        setTorchEnabled(false);
      } else if (!wasActive && isActive) {
        void startScan();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [startScan]);

  return {
    isScanning,
    startScan,
    stopScan,
    handleScan,
    result,
    error,
    permissionDenied,
    torchSupported,
    torchEnabled,
    toggleTorch,
    submitManualCode,
  };
}

export default useQRScanner;
