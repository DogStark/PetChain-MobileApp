import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { getPetById } from '../services/petService';
import { generateAppointmentCheckinQRCode } from '../services/qrService';

interface AppointmentDetailScreenProps {
  route: {
    params: {
      appointmentId: string;
      petId: string;
      appointmentTitle?: string;
      appointmentDate?: string;
    };
  };
}

const AppointmentDetailScreen: React.FC<AppointmentDetailScreenProps> = ({ route }) => {
  const { appointmentId, petId, appointmentTitle, appointmentDate } = route.params;

  const [loading, setLoading] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const onShowQR = async () => {
    try {
      setLoading(true);
      // Ensure pet exists locally / fetch
      await getPetById(petId);

      const { payload, imageUrl } = await generateAppointmentCheckinQRCode(petId, appointmentId, {
        imageSize: 600,
      });

      setQrPayload(payload);
      setQrUrl(imageUrl);
      setModalVisible(true);
    } catch (err) {
      Alert.alert('Unable to generate QR', String(err));
    } finally {
      setLoading(false);
    }
  };

  const onShare = async () => {
    if (!qrUrl) return;
    try {
      await Share.share({
        message: `Check-in QR: ${qrUrl}`,
        url: qrUrl,
        title: 'PetChain Check-in QR',
      });
    } catch (err) {
      // ignore
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{appointmentTitle ?? 'Appointment'}</Text>
        <Text style={styles.subtitle}>{appointmentDate ?? ''}</Text>
      </View>

      <View style={styles.body}>
        <TouchableOpacity style={styles.button} onPress={onShowQR} accessibilityRole="button">
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Show Check-in QR</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onShare} style={styles.shareButton}>
              <Text style={styles.shareText}>Share</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.qrContainer}>
            {qrUrl ? (
              <Image source={{ uri: qrUrl }} style={styles.qrImage} resizeMode="contain" />
            ) : (
              <ActivityIndicator size="large" />
            )}
            <Text style={styles.expiryText}>QR expires in 24 hours from generation</Text>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: { padding: 20, borderBottomWidth: 1, borderColor: '#eee' },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { marginTop: 6, color: '#6b7280' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  button: {
    backgroundColor: '#10B981',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalContainer: { flex: 1, backgroundColor: '#000' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    alignItems: 'center',
  },
  closeButton: {},
  closeText: { color: '#fff', fontSize: 16 },
  shareButton: {},
  shareText: { color: '#fff', fontSize: 16 },
  qrContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  qrImage: { width: '92%', height: '70%' },
  expiryText: { color: '#fff', marginTop: 12 },
});

export default AppointmentDetailScreen;
