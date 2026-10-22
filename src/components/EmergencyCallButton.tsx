/**
 * EmergencyCallButton — Issue #144/#75: Emergency call integration
 *
 * A prominent, accessible call button that uses the device phone API
 * (via React Native's Linking) to place a direct call.
 * Designed to work reliably in emergency situations:
 *  - Confirms before dialling (optional, skippable for speed)
 *  - Falls back gracefully if the device cannot make calls
 *  - Accessible label for screen readers
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface Props {
  /** Phone number to dial */
  phoneNumber: string;
  /** Display label (e.g. contact name) */
  label?: string;
  /** Skip the confirmation dialog — useful for one-tap emergency buttons */
  skipConfirm?: boolean;
  /** Optional extra container style */
  style?: StyleProp<ViewStyle>;
  /** Compact mode: renders a small icon-only button */
  compact?: boolean;
}

/**
 * Initiates a phone call using the tel: URI scheme.
 * Returns true if the call was launched, false if unsupported.
 */
export async function initiateCall(phoneNumber: string): Promise<boolean> {
  const url = `tel:${phoneNumber}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;
  await Linking.openURL(url);
  return true;
}

const EmergencyCallButton: React.FC<Props> = ({
  phoneNumber,
  label,
  skipConfirm = false,
  style,
  compact = false,
}) => {
  const [calling, setCalling] = useState(false);

  const handleCall = useCallback(async () => {
    if (!phoneNumber?.trim()) {
      Alert.alert('No number', 'No phone number is available for this contact.');
      return;
    }

    const doCall = async () => {
      setCalling(true);
      try {
        const ok = await initiateCall(phoneNumber);
        if (!ok) {
          Alert.alert(
            'Cannot make calls',
            Platform.OS === 'ios'
              ? 'This device does not support phone calls.'
              : 'Phone calls are not supported on this device.',
          );
        }
      } finally {
        setCalling(false);
      }
    };

    if (skipConfirm) {
      await doCall();
      return;
    }

    Alert.alert('Call ' + (label ?? phoneNumber), `Dial ${phoneNumber}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call', style: 'default', onPress: () => void doCall() },
    ]);
  }, [phoneNumber, label, skipConfirm]);

  if (compact) {
    return (
      <TouchableOpacity
        style={[styles.compactBtn, style]}
        onPress={() => void handleCall()}
        accessibilityRole="button"
        accessibilityLabel={`Call ${label ?? phoneNumber}`}
        accessibilityHint="Initiates a phone call"
        disabled={calling}
      >
        {calling ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.compactIcon}>📞</Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      onPress={() => void handleCall()}
      accessibilityRole="button"
      accessibilityLabel={`Call ${label ?? phoneNumber}`}
      accessibilityHint="Initiates a phone call"
      disabled={calling}
      activeOpacity={0.8}
    >
      {calling ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <View style={styles.btnInner}>
          <Text style={styles.btnIcon}>📞</Text>
          <View>
            {label ? <Text style={styles.btnLabel}>{label}</Text> : null}
            <Text style={styles.btnNumber}>{phoneNumber}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    backgroundColor: '#e53e3e',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#e53e3e',
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 6 },
    }),
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  btnIcon: { fontSize: 22 },
  btnLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnNumber: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  compactBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e53e3e',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#e53e3e',
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 4 },
    }),
  },
  compactIcon: { fontSize: 18 },
});

export default EmergencyCallButton;
