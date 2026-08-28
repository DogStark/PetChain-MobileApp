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
          <Text style={styles.permissionText}>Requesting camera permission...</Text>
        </View>
      );
    }

    if (cameraPermissionAllowsCamera(permissionState)) {
      if (!cameraActive) {
        return (
          <View
            style={styles.permissionContainer}
            accessibilityLabel="Scanner paused"
            accessibilityRole="text"
          >
            <Text style={styles.permissionText}>
              Scanner paused — open the app to resume scanning.
            </Text>
          </View>
        );
      }

      return (
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            enableTorch={torchEnabled}
            onBarcodeScanned={
              scanned
                ? undefined
                : (result) => handleBarCodeScanned({ data: result.data } as BarCodeScannerResult)
            }
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'datamatrix', 'pdf417'],
            }}
          >
            <View style={styles.overlay}>
              <View
                style={styles.scanFrame}
                accessibilityLabel="QR code scanner viewfinder — align QR code within the frame"
                accessibilityRole="image"
              >
                <View style={[styles.scanCorner, styles.topLeft]} />
                <View style={[styles.scanCorner, styles.topRight]} />
                <View style={[styles.scanCorner, styles.bottomLeft]} />
                <View style={[styles.scanCorner, styles.bottomRight]} />
                {scanned && (
                  <View style={styles.scanningIndicator}>
                    <Text style={styles.scanningText}>Processing...</Text>
                  </View>
                )}
              </View>
              <Text
                style={styles.scanText}
                accessibilityLabel="Align QR code within frame"
                accessibilityRole="text"
              >
                Align QR code within frame
              </Text>
            </View>
          </CameraView>

          <View style={styles.controlsContainer}>
            <TouchableOpacity
              style={[styles.controlButton, torchEnabled && styles.controlButtonActive]}
              onPress={toggleTorch}
              accessibilityLabel={torchEnabled ? 'Turn off flashlight' : 'Turn on flashlight'}
              accessibilityRole="button"
              accessibilityState={{ selected: torchEnabled }}
            >
              <Text style={styles.controlButtonText}>💡</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={onManualEntry}
              accessibilityLabel="Enter code manually"
              accessibilityRole="button"
            >
              <Text style={styles.controlButtonText}>📝</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (permissionState === 'undetermined') {
      return (
        <View
          style={styles.permissionContainer}
          accessibilityLabel="Camera permission needed"
          accessibilityRole="alert"
        >
          <Text style={styles.permissionText}>
            Camera permission is needed to scan a PetChain QR code.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={() => void requestCameraPermission()}
            accessibilityLabel="Allow camera"
            accessibilityRole="button"
          >
            <Text style={styles.permissionButtonText}>Allow Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.manualEntryButton}
            onPress={onManualEntry}
            accessibilityLabel="Enter code manually"
            accessibilityRole="button"
          >
            <Text style={styles.manualEntryButtonText}>Manual Entry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const requiresSettings = cameraPermissionRequiresSettings(permissionState);
    return (
      <View
        style={styles.permissionContainer}
        accessibilityLabel={`Camera permission ${permissionState}`}
        accessibilityRole="alert"
      >
        <Text style={styles.permissionText}>{getPermissionMessage(permissionState)}</Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requiresSettings ? handlePermissionDenied : () => setShowRationale(true)}
          accessibilityLabel={requiresSettings ? 'Open Settings' : 'Allow Camera'}
          accessibilityRole="button"
        >
          <Text style={styles.permissionButtonText}>
            {requiresSettings ? 'Open Settings' : 'Allow Camera'}
          </Text>
        </TouchableOpacity>
        {permissionState !== 'unavailable' && (
          <TouchableOpacity
            style={styles.manualEntryButton}
            onPress={onManualEntry}
            accessibilityLabel="Enter code manually"
            accessibilityRole="button"
          >
            <Text style={styles.manualEntryButtonText}>Manual Entry</Text>
          </TouchableOpacity>
        )}
        {renderManualCodeFallback()}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <PermissionRationaleModal
        visible={showRationale}
        permissionType="camera"
        showSettings={permissionState === 'denied-permanently' || permissionState === 'restricted'}
        onAllow={() => {
          setShowRationale(false);
          void requestCameraPermission();
        }}
        onDeny={() => setShowRationale(false)}
      />
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          accessibilityLabel="Close scanner"
          accessibilityRole="button"
        >
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
        <Text
          style={styles.headerTitle}
          accessibilityLabel="Scan QR Code"
          accessibilityRole="header"
        >
          Scan QR Code
        </Text>
        <View style={styles.placeholder} />
      </View>
      <View
        style={styles.scannerContainer}
        accessibilityLabel="QR code scanner"
        accessibilityRole="image"
      >
        {renderCameraView()}
      </View>
      <View
        style={styles.footer}
        accessibilityLabel="Scan a PetChain QR code to access pet records, or enter a code manually"
        accessibilityRole="text"
      >
        <Text style={styles.footerText}>Scan a PetChain QR code to access pet records</Text>
        <TouchableOpacity
          style={styles.manualEntryButton}
          onPress={onManualEntry}
          accessibilityLabel="Enter code manually"
          accessibilityRole="button"
        >
          <Text style={styles.manualEntryButtonText}>Manual Entry</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#1F2937',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  placeholder: { width: 40 },
  scannerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  cameraContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 280,
    height: 280,
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  scanCorner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#10B981',
  },
  topLeft: { top: -2, left: -2, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 16,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 16,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: 16,
  },
  scanningIndicator: {
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  scanningText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  scanText: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 30,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 120,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '60%',
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
    borderColor: '#10B981',
  },
  controlButtonText: { fontSize: 28 },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permissionButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  footer: { backgroundColor: '#1F2937', padding: 20, alignItems: 'center' },
  footerText: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 15,
  },
  manualEntryButton: {
    backgroundColor: '#10B981',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  manualEntryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },

  manualCodeContainer: {
    marginTop: 24,
    width: '100%',
    alignItems: 'center',
  },
  manualCodeInput: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.4)',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#4B5563',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  manualCodeButton: {
    marginTop: 12,
    backgroundColor: '#10B981',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  manualCodeButtonDisabled: {
    opacity: 0.5,
  },
  manualCodeButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});

export default QRScannerScreen;
