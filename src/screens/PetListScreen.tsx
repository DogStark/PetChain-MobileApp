import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import petService, { type Pet } from '../services/petService';
import { getPhoto } from '../utils/petPhotoStore';

interface Props {
  onSelectPet: (pet: Pet) => void;
  onAddPet: () => void;
}

const PetListScreen: React.FC<Props> = ({ onSelectPet, onAddPet }) => {
  const [pets, setPets] = useState<Pet[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await petService.getAllPets();
      setPets(data);
      const photoMap: Record<string, string> = {};
      await Promise.all(
        data.map(async (p) => {
          const uri = await getPhoto(p.id);
          if (uri) photoMap[p.id] = uri;
        }),
      );
      setPhotos(photoMap);
    } catch {
      Alert.alert('Error', 'Failed to load pets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const renderItem = ({ item }: { item: Pet }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onSelectPet(item)}
      testID={`pet-item-${item.id}`}
    >
      {photos[item.id] ? (
        <Image source={{ uri: photos[item.id] }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarEmoji}>🐾</Text>
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={styles.petName}>{item.name}</Text>
        <Text style={styles.petMeta}>
          {item.species}
          {item.breed ? ` · ${item.breed}` : ''}
        </Text>
        {item.dateOfBirth && (
          <Text style={styles.petMeta}>
            Born: {new Date(item.dateOfBirth).toLocaleDateString()}
          </Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Pets</Text>
        <TouchableOpacity style={styles.addBtn} onPress={onAddPet} testID="add-pet-button">
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#4CAF50" />
      ) : (
        <FlatList
          data={pets}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No pets yet. Add one!</Text>}
          onRefresh={load}
          refreshing={loading}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  addBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '600' },
  loader: { marginTop: 40 },
  list: { padding: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#e8f5e9', justifyContent: 'center', alignItems: 'center' },
  avatarEmoji: { fontSize: 24 },
  cardInfo: { flex: 1 },
  petName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  petMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  chevron: { fontSize: 22, color: '#bbb' },
  empty: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 15 },
});

export default PetListScreen;
