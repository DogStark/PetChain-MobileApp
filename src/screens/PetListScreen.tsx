import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import AppText from '../components/AppText';
import petService, { type Pet } from '../services/petService';
import { getPhoto } from '../utils/petPhotoStore';
import { scale, scaleFont } from '../utils/scaling';

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
    <TouchableOpacity style={styles.card} onPress={() => onSelectPet(item)}>
      {photos[item.id] ? (
        <Image source={{ uri: photos[item.id] }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <AppText style={styles.avatarEmoji}>🐾</AppText>
        </View>
      )}
      <View style={styles.cardInfo}>
        <AppText style={styles.petName}>{item.name}</AppText>
        <AppText style={styles.petMeta}>
          {item.species}
          {item.breed ? ` · ${item.breed}` : ''}
        </AppText>
        {item.dateOfBirth && (
          <AppText style={styles.petMeta}>
            Born: {new Date(item.dateOfBirth).toLocaleDateString()}
          </AppText>
        )}
      </View>
      <AppText style={styles.chevron}>›</AppText>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <AppText style={styles.title}>My Pets</AppText>
        <TouchableOpacity style={styles.addBtn} onPress={onAddPet}>
          <AppText style={styles.addBtnText}>+ Add</AppText>
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
          ListEmptyComponent={<AppText style={styles.empty}>No pets yet. Add one!</AppText>}
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
    padding: scale(16),
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: scaleFont(20), fontWeight: '700', color: '#1a1a1a' },
  addBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: scale(14),
    paddingVertical: scale(8),
    borderRadius: scale(8),
  },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: scaleFont(14) },
  loader: { marginTop: scale(40) },
  list: { padding: scale(12) },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: scale(10),
    padding: scale(12),
    marginBottom: scale(10),
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: scale(4),
    elevation: 2,
  },
  avatar: { width: scale(56), height: scale(56), borderRadius: scale(28), marginRight: scale(12) },
  avatarPlaceholder: { backgroundColor: '#e8f5e9', justifyContent: 'center', alignItems: 'center' },
  avatarEmoji: { fontSize: scaleFont(24) },
  cardInfo: { flex: 1 },
  petName: { fontSize: scaleFont(16), fontWeight: '700', color: '#1a1a1a' },
  petMeta: { fontSize: scaleFont(13), color: '#666', marginTop: scale(2) },
  chevron: { fontSize: scaleFont(22), color: '#bbb' },
  empty: { textAlign: 'center', color: '#999', marginTop: scale(40), fontSize: scaleFont(15) },
});

export default PetListScreen;
