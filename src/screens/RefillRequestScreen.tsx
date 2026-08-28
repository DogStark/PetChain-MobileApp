import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  RefreshControl,
} from 'react-native';

type Prescription = {
  id: string;
  name: string;
  dosage?: string;
  status: 'active' | 'pending' | 'approved' | 'denied' | 'ready_for_pickup';
};

const BASE_URL = 'http://localhost:3000/api'; // change to your backend URL

const RefillRequestScreen = () => {
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const fetchPrescriptions = async () => {
    try {
      const res = await fetch(`${BASE_URL}/prescriptions`);
      const data = await res.json();
      setPrescriptions(data);
    } catch {
      Alert.alert('Error', 'Failed to load prescriptions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPrescriptions();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPrescriptions();
  };

  const requestRefill = async (id: string) => {
    try {
      setRequestingId(id);

      const res = await fetch(`${BASE_URL}/prescriptions/${id}/refill`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error();

      Alert.alert('Success', 'Refill request sent to vet');

      // refresh list after request
      fetchPrescriptions();
    } catch {
      Alert.alert('Error', 'Failed to request refill');
    } finally {
      setRequestingId(null);
    }
  };

  const getStatusColor = (status: Prescription['status']) => {
    switch (status) {
      case 'approved':
        return '#4CAF50';
      case 'denied':
        return '#F44336';
      case 'pending':
        return '#FF9800';
      case 'ready_for_pickup':
        return '#2196F3';
      default:
        return '#9E9E9E';
    }
  };

  const renderItem = ({ item }: { item: Prescription }) => {
    const isRequesting = requestingId === item.id;

    return (
      <View style={styles.card}>
        <Text style={styles.name}>{item.name}</Text>

        {item.dosage && <Text style={styles.dosage}>Dosage: {item.dosage}</Text>}

        <Text style={[styles.status, { color: getStatusColor(item.status) }]}>
          Status: {item.status.replace('_', ' ')}
        </Text>

        <TouchableOpacity
          style={[styles.button, (item.status === 'pending' || isRequesting) && styles.disabledBtn]}
          disabled={item.status === 'pending' || isRequesting}
          onPress={() => requestRefill(item.id)}
        >
          {isRequesting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {item.status === 'active' ? 'Request Refill' : 'Request Again'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>Loading prescriptions...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={prescriptions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>No active prescriptions found</Text>
          </View>
        }
      />
    </View>
  );
};

export default RefillRequestScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  card: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: '#f7f7f7',
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  dosage: {
    fontSize: 14,
    marginBottom: 6,
    color: '#555',
  },
  status: {
    fontSize: 14,
    marginBottom: 12,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#000',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledBtn: {
    backgroundColor: '#999',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
