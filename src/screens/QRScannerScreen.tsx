import type { BarCodeScannerResult } from 'expo-barcode-scanner';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import PermissionRationaleModal from '../components/PermissionRationaleModal';
import { scanQRCode } from '../services/qrCodeService';
import {
  cameraPermissionAllowsCamera,
  cameraPermissionRequiresSettings,
  resolveCameraPermissionState,
  type CameraPermissionState,
} from '../utils/cameraPermission';
import { createScanLock } from '../utils/scanLock';
import { useSecureScreen } from '../utils/secureScreen';

const SCAN_DEBOUNCE_MS = 500;

interface QRScannerScreenProps {
  onScanSuccess: (data: string) => void;
  onClose: () => void;
  onManualEntry: () => void;
}

const QRScannerScreen: React.FC<QRScannerScreenProps> = ({
  onScanSuccess,
  onClose,
  onManualEntry,
}) => {
  useSecureScreen();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [manualValidating, setManualValidating] = useState(false);
  const scanLockRef = useRef(createScanLock(SCAN_DEBOUNCE_MS));
  const manualInputRef = useRef<TextInput>(null);

  // Lifecycle + navigation identity guards. `mountedRef` flips false on unmount
  // so late async scan results cannot navigate on a stale stack. `navTokenRef`
  // is bumped whenever the screen is torn down or backgrounded, invalidating
  // any in-flight decode work started under the previous token.
  const mountedRef = useRef(true);
  const navTokenRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const permissionState: CameraPermissionState = resolveCameraPermissionState(permission);
  const isPermissionLoading = permission == null;

  const requestCameraPermission = useCallback(async () => {
    try {
      const result = await requestPermission();
      if (
        result?.status &&
        result.status !== 'granted' &&
        Platform.OS === 'android' &&
        result.canAskAgain !== false
      ) {
        setShowRationale(true);
      }
    } catch (err) {
      console.warn('Camera permission error:', err);
    }
  }, [requestPermission]);

  // Request permission once on mount. Re-arming on return to foreground is
  // handled by the AppState listener below.
  useEffect(() => {
    void requestCameraPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark the screen unmounted and invalidate any pending decode work so a late
  // scan result cannot navigate on a stale stack.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      navTokenRef.current += 1;
      scanLockRef.current.reset();
    };
  }, []);

  // Stop the capture session when the app is backgrounded or the screen is not
  // the active one, resuming it once the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      appStateRef.current = state;
      if (state === 'active') {
        setCameraActive(true);
        scanLockRef.current.reset();
      } else {
        // Backgrounding cancels any in-flight decode work by invalidating the
        // current navigation token.
        navTokenRef.current += 1;
        setCameraActive(false);
        setScanned(false);
        setTorchEnabled(false);
        scanLockRef.current.reset();
      }
    });
    return () => subscription.remove();
  }, []);

  const handleBarCodeScanned = useCallback(
    ({ data }: BarCodeScannerResult) => {
      if (!data) return;
      if (!mountedRef.current) return;
      if (appStateRef.current !== 'active') return;
      if (scanLockRef.current.shouldSkip()) return;
      scanLockRef.current.lock();

      if (!scanned) setScanned(true);

      const token = navTokenRef.current;

      void (async () => {
        const result = await scanQRCode(data);

        // Ignore results that resolve after unmount, after backgrounding, or
        // after a newer scan/navigation cycle has started.
        if (!mountedRef.current) return;
        if (token !== navTokenRef.current) return;
        if (appStateRef.current !== 'active') return;

        if (result.valid && result.petId) {
          // Provide haptic feedback on successful scan
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          // Announce to screen readers
          AccessibilityInfo.announceForAccessibility('QR code detected');

          onScanSuccess(data);
        } else {
          const isExpiredOrUsed =
            result.error === 'This code has expired' ||
            result.error === 'This code has already been used' ||
            result.error === 'This code has been revoked';

          Alert.alert(
            isExpiredOrUsed ? 'Code No Longer Valid' : 'Invalid QR Code',
            result.error || 'This QR code is not a valid PetChain record.',
            [
              {
                text: 'Try Again',
                onPress: () => {
                  scanLockRef.current.reset();
                  setScanned(false);
                },
              },
              { text: 'Manual Entry', onPress: onManualEntry },
              { text: 'Cancel', style: 'cancel', onPress: onClose },
            ],
          );
        }
      })();
    },
    [onManualEntry, onClose, onScanSuccess, scanned],
  );

  const handleManualCodeSubmit = useCallback(async () => {
    const code = manualCode.trim();
    if (!code) return;
    setManualValidating(true);
    const token = navTokenRef.current;
    try {
      const result = await scanQRCode(code);
      if (!mountedRef.current) return;
      if (token !== navTokenRef.current) return;
      if (result.valid && result.petId) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        AccessibilityInfo.announceForAccessibility('QR code detected');
        onScanSuccess(code);
      } else {
        Alert.alert(
          'Invalid QR Code',
          result.error || 'This code is not a valid PetChain record.',
          [{ text: 'OK' }, { text: 'Manual Entry', onPress: onManualEntry }],
        );
      }
    } finally {
      if (mountedRef.current) setManualValidating(false);
    }
  }, [manualCode, onManualEntry, onScanSuccess]);

  const toggleTorch = () => setTorchEnabled(!torchEnabled);

  const handlePermissionDenied = () => {
    Alert.alert(
      'Camera Permission Required',
      'Please enable camera access in your device settings.',
      [
        {
          text: 'Open Settings',
          onPress: () => Linking.openSettings(),
        },
        { text: 'Manual Entry', onPress: onManualEntry },
        { text: 'Cancel', style: 'cancel', onPress: onClose },
      ],
    );
  };

  const getPermissionMessage = (state: CameraPermissionState): string => {
    switch (state) {
      case 'denied':
        return 'Camera access is needed to scan a PetChain QR code. You can allow it now or enter your code manually.';
      case 'denied-permanently':
        return 'Camera access has been permanently denied. Enable it in your device settings to scan, or enter your code manually.';
      case 'restricted':
        return 'Camera access is restricted on this device. Enable it in your device settings to scan, or enter your code manually.';
      case 'unavailable':
        return 'The camera is unavailable on this device. You can enter your PetChain code manually.';
      default:
        return 'Camera access is required to scan QR codes.';
    }
  };

  const renderManualCodeFallback = () => (
    <View style={styles.manualCodeContainer}>
      <TextInput
        ref={manualInputRef}
        style={styles.manualCodeInput}
        value={manualCode}
        onChangeText={setManualCode}
        placeholder="Or paste a PetChain QR code"
        placeholderTextColor="#9CA3AF"
        autoCapitalize="none"
        autoCorrect={false}
        accessible
        accessibilityLabel="Paste a PetChain QR code"
        onSubmitEditing={() => void handleManualCodeSubmit()}
        returnKeyType="go"
      />
      <TouchableOpacity
        style={[
          styles.manualCodeButton,
          (!manualCode.trim() || manualValidating) && styles.manualCodeButtonDisabled,
        ]}
        onPress={() => void handleManualCodeSubmit()}
        disabled={!manualCode.trim() || manualValidating}
        accessibilityLabel="Validate code"
        accessibilityRole="button"
      >
        <Text style={styles.manualCodeButtonText}>
          {manualValidating ? 'Checking...' : 'Validate'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderCameraView = () => {
    if (isPermissionLoading) {
      return (
        <View
          style={styles.permissionContainer}
          accessibilityLabel="Requesting camera permission"
          accessibilityRole="text"
        >
          <Text style={styles.permissionText}>Requesting camera permission…</Text>
        </View>
      );
    }

    if (!cameraPermissionAllowsCamera(permissionState)) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>{getPermissionMessage(permissionState)}</Text>
          {cameraPermissionRequiresSettings(permissionState) ? (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={handlePermissionDenied}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Text style={styles.permissionButtonText}>Open Settings</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={() => void requestCameraPermission()}
              accessibilityRole="button"
              accessibilityLabel="Allow camera access"
            >
              <Text style={styles.permissionButtonText}>Allow Camera</Text>
            </TouchableOpacity>
          )}
          {renderManualCodeFallback()}
        </View>
      );
    }

    return (
      <View style={styles.cameraContainer}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torchEnabled}
          active={cameraActive}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        <View style={styles.overlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.hintText}>Align the QR code within the frame</Text>
        </View>
        <TouchableOpacity
          style={styles.torchButton}
          onPress={toggleTorch}
          accessibilityRole="button"
          accessibilityLabel={torchEnabled ? 'Turn off torch' : 'Turn on torch'}
        >
          <Text style={styles.torchButtonText}>{torchEnabled ? 'Torch On' : 'Torch Off'}</Text>
        </TouchableOpacity>
        {renderManualCodeFallback()}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
        >
          <Text style={styles.headerButtonText}>Close</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <TouchableOpacity
          onPress={onManualEntry}
          accessibilityRole="button"
          accessibilityLabel="Enter code manually"
        >
          <Text style={styles.headerButtonText}>Manual</Text>
        </TouchableOpacity>
      </View>
      {renderCameraView()}
      <PermissionRationaleModal
        visible={showRationale}
        onClose={() => setShowRationale(false)}
        onOpenSettings={() => {
          setShowRationale(false);
          void Linking.openSettings();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  headerButtonText: {
    color: '#60A5FA',
    fontSize: 16,
  },
  cameraContainer: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 16,
  },
  hintText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 14,
  },
  torchButton: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 24,
  },
  torchButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionText: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
  permissionButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#2563EB',
    borderRadius: 8,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  manualCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  manualCodeInput: {
    flex: 1,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#4B5563',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  manualCodeButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#2563EB',
    borderRadius: 8,
  },
  manualCodeButtonDisabled: {
    opacity: 0.5,
  },
  manualCodeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default QRScannerScreen;
