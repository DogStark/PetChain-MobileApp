import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  PermissionsAndroid,
  Linking,
} from 'react-native';

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
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  useEffect(() => {
    requestCameraPermission();
    return () => {
      // Cleanup scanner if needed
    };
  }, []);

  const requestCameraPermission = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
          title: 'Camera Permission',
          message: 'PetChain needs camera permission to scan QR codes',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        });
        setHasPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
      } else {
        // iOS permissions are handled differently
        setHasPermission(true);
      }
    } catch (err) {
      console.warn('Camera permission error:', err);
      setHasPermission(false);
    }
  };

  const _handleBarCodeRead = (event: any) => {
    const { data } = event;

    if (data && scanning) {
      setScanning(false);

      // Validate QR code data format
      if (isValidPetChainQR(data)) {
        onScanSuccess(data);
      } else {
        Alert.alert(
          'Invalid QR Code',
          'This QR code is not a valid PetChain record. Please scan a PetChain QR code.',
          [
            {
              text: 'Try Again',
              onPress: () => setScanning(true),
            },
            {
              text: 'Manual Entry',
              onPress: onManualEntry,
            },
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: onClose,
            },
          ],
        );
      }
    }
  };
  void _handleBarCodeRead; // suppress noUnusedLocals until camera library is wired up

  const isValidPetChainQR = (data: string): boolean => {
    try {
      // Check if it's a PetChain QR code format
      // Expected format: "petchain://record/{recordId}" or JSON with record data
      if (data.startsWith('petchain://record/')) {
        return true;
      }

      // Try to parse as JSON
      const parsed = JSON.parse(data);
      return parsed && (parsed.recordId || parsed.petId || parsed.vetId);
    } catch {
      return false;
    }
  };

  const toggleTorch = () => {
    setTorchEnabled(!torchEnabled);
    // In a real implementation, you would control the camera torch here
  };

  const handlePermissionDenied = () => {
    Alert.alert(
      'Camera Permission Required',
      'PetChain needs camera permission to scan QR codes. Please enable camera access in your device settings.',
      [
        {
          text: 'Open Settings',
          onPress: () => Linking.openSettings(),
        },
        {
          text: 'Manual Entry',
          onPress: onManualEntry,
        },
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: onClose,
        },
      ],
    );
  };

  const renderCameraView = () => {
    if (hasPermission === null) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Requesting camera permission...</Text>
        </View>
      );
    }

    if (hasPermission === false) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Camera permission denied</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={handlePermissionDenied}>
            <Text style={styles.permissionButtonText}>Enable Camera</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.cameraContainer}>
        {/* Camera view placeholder - in real implementation, use react-native-camera */}
        <View style={styles.cameraPlaceholder}>
          <View style={styles.scanFrame}>
            <View style={[styles.scanCorner, styles.topLeft]} />
            <View style={[styles.scanCorner, styles.topRight]} />
            <View style={[styles.scanCorner, styles.bottomLeft]} />
            <View style={[styles.scanCorner, styles.bottomRight]} />
            <Text style={styles.scanText}>Align QR code within frame</Text>
          </View>
        </View>

        <View style={styles.controlsContainer}>
          <TouchableOpacity style={styles.controlButton} onPress={toggleTorch}>
            <Text style={styles.controlButtonText}>{torchEnabled ? '🔦' : '🔦'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={onManualEntry}>
            <Text style={styles.controlButtonText}>📝</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderHeader = () => {
    return (
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <View style={styles.placeholder} />
      </View>
    );
  };

  const renderFooter = () => {
    return (
      <View style={styles.footer}>
        <Text style={styles.footerText}>Scan a PetChain QR code to access pet records</Text>
        <TouchableOpacity style={styles.manualEntryButton} onPress={onManualEntry}>
          <Text style={styles.manualEntryButtonText}>Manual Entry</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {renderHeader()}

      <View style={styles.scannerContainer}>{renderCameraView()}</View>

      {renderFooter()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
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
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
  scannerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraPlaceholder: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  scanCorner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#10B981',
  },
  topLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  scanText: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 100,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 40,
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonText: {
    fontSize: 24,
  },
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
  permissionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    backgroundColor: '#1F2937',
    padding: 20,
    alignItems: 'center',
  },
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
  manualEntryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default QRScannerScreen;
