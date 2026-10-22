import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import type { Pet } from '../models/Pet';
import { generatePetQRCode, getQRImageUrl } from '../services/qrCodeService';

interface Props {
  pet: Pet;
  size?: number;
}

const QRCodeDisplay: React.FC<Props> = ({ pet, size = 240 }) => {
  const [qrData, setQrData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    generatePetQRCode(pet)
      .then((data) => {
        if (mounted) setQrData(data);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to generate QR code');
      });
    return () => {
      mounted = false;
    };
  }, [pet]);

  if (error) {
    return <Text style={styles.error}>{error}</Text>;
  }

  if (!qrData) {
    return <ActivityIndicator size="large" color="#4CAF50" />;
  }

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: getQRImageUrl(qrData, size) }}
        style={{ width: size, height: size }}
        accessibilityLabel={`${pet.name} PetChain QR code`}
      />
      <Text style={styles.caption}>Scan for {pet.name}'s emergency profile</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  caption: { marginTop: 8, color: '#4b5563', fontSize: 13, textAlign: 'center' },
  error: { color: '#c62828', textAlign: 'center' },
});

export default QRCodeDisplay;
