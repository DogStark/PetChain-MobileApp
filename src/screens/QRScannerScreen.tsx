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
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [manualValidating, setManualValidating] = useState(false);
  const scanLockRef = useRef(createScanLock(SCAN_DEBOUNCE_MS));
  const manualInputRef = useRef<TextInput>(null);
  const cameraRef = useRef<CameraView>(null);

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

  // Stop the capture session when the app is backgrounded or the screen is not
  // the active one, resuming it once the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        setCameraActive(true);
        scanLockRef.current.reset();
      } else {
        setCameraActive(false);
        setScanned(false);
        setTorchEnabled(false);
        scanLockRef.current.reset();
      }
    });
    return () => subscription.remove();
  }, []);

  // Re-check permission whenever the app returns to the foreground so that a
  // user who granted access from Settings can resume scanning without a restart.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void requestCameraPermission();
      }
    });
    return () => subscription.remove();
  }, [requestCameraPermission]);

  const handleBarCodeScanned = useCallback(
    ({ data }: BarCodeScannerResult) => {
      if (!data) return;
      if (scanLockRef.current.shouldSkip()) return;
      scanLockRef.current.lock();

      if (!scanned) setScanned(true);

      void (async () => {
        const result = await scanQRCode(data);

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
    try {
      const result = await scanQRCode(code);
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
      setManualValidating(false);
    }
  }, [manualCode, onManualEntry, onScanSuccess]);

  const toggleTorch = useCallback(() => {
    if (!torchAvailable) return;
    setTorchEnabled((prev) => !prev);
  }, [torchAvailable]);

  const handleCameraReady = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    // Only expose torch controls when the active camera reports support.
    const available = typeof camera.getAvailableTorchModes === 'function'
      ? camera.getAvailableTorchModes().length > 0
      : false;
    setTorchAvailable(available);
    if (!available) setTorchEnabled(false);
  }, []);

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
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionText}>{getPermissionMessage(permissionState)}</Text>
          {cameraPermissionRequiresSettings(permissionState) ? (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={() => Linking.openSettings()}
              accessibilityRole="button"
              accessibilityLabel="Open device settings"
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
        {cameraActive ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torchEnabled}
            onCameraReady={handleCameraReady}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
        ) : (
          <View style={styles.cameraPaused}>
            <Text style={styles.permissionText}>Camera paused</Text>
          </View>
        )}
        {torchAvailable && cameraActive ? (
          <TouchableOpacity
            style={[styles.torchButton, torchEnabled && styles.torchButtonActive]}
            onPress={toggleTorch}
            accessibilityRole="button"
            accessibilityState={{ selected: torchEnabled }}
            accessibilityLabel={torchEnabled ? 'Turn off flashlight' : 'Turn on flashlight'}
          >
            <Text style={styles.torchButtonText}>{torchEnabled ? 'Torch On' : 'Torch Off'}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Align the QR code within the frame</Text>
        </View>
        {renderManualCodeFallback()}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
        >
          <Text style={styles.closeButton}>Close</Text>
        </TouchableOpacity>
      </View>
      {renderCameraView()}
      <PermissionRationaleModal
        visible={showRationale}
        onDismiss={() => setShowRationale(false)}
        onOpenSettings={() => {
          setShowRationale(false);
          void Linking.openSettings();
        }}
        onManualEntry={() => {
          setShowRationale(false);
          onManualEntry();
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    color: '#fff',
    fontSize: 16,
  },
  cameraContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  cameraPaused: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  overlayText: {
    color: '#fff',
    fontSize: 14,
  },
  torchButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  torchButtonActive: {
    backgroundColor: '#F59E0B',
  },
  torchButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  permissionText: {
    color: '#D1D5DB',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 16,
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
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  manualCodeButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  manualCodeButtonDisabled: {
    opacity: 0.5,
  },
  manualCodeButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default QRScannerScreen;
