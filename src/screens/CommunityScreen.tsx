import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { v4 as uuid } from 'uuid';

import type { CommunityPost, PostCategory } from '../models/CommunityPost';
import type { RootStackParamList } from '../navigation/types';
import { createPost, deletePost, getPosts, toggleLike } from '../services/communityService';

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | PostCategory;

const CATEGORIES: { key: PostCategory; label: string }[] = [
  { key: 'forum', label: '💬 Forum' },
  { key: 'tip', label: '💡 Tips' },
  { key: 'app', label: '📱 Apps' },
];

const EMPTY_FORM = { title: '', body: '', category: 'forum' as PostCategory };

// ─── Component ────────────────────────────────────────────────────────────────

const CommunityScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setPosts(await getPosts());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const displayed = filter === 'all' ? posts : posts.filter((p) => p.category === filter);

  // ─── Create ─────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      Alert.alert('Missing fields', 'Title and body are required.');
      return;
    }
    await createPost({
      authorId: uuid(),
      authorName: 'You',
      category: form.category,
      title: form.title.trim(),
      body: form.body.trim(),
    });
    setForm(EMPTY_FORM);
    setModalVisible(false);
    await load();
  };

  // ─── Like ────────────────────────────────────────────────────────────────────

  const handleLike = async (postId: string) => {
    const updated = await toggleLike(postId);
    if (updated) {
      setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = (postId: string) => {
    Alert.alert('Delete post', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePost(postId);
          await load();
        },
      },
    ]);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  const renderPost = ({ item }: { item: CommunityPost }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.categoryBadge}>{categoryLabel(item.category)}</Text>
        <Text style={styles.authorText}>{item.authorName}</Text>
      </View>
      <Text style={styles.postTitle}>{item.title}</Text>
      <Text style={styles.postBody} numberOfLines={3}>
        {item.body}
      </Text>
      <View style={styles.cardFooter}>
        <TouchableOpacity onPress={() => handleLike(item.id)} style={styles.likeBtn}>
          <Text style={styles.likeBtnText}>
            {item.likedByMe ? '❤️' : '🤍'} {item.likes}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item.id)}>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Filter tabs */}
      <TouchableOpacity style={styles.forumNavBtn} onPress={() => navigation.navigate('Forum')}>
        <Text style={styles.forumNavText}>Go to verified Forum</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.forumNavBtn} onPress={() => navigation.navigate('LostFound')}>
        <Text style={styles.forumNavText}>Open Lost & Found Network</Text>
      </TouchableOpacity>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterTabText, filter === 'all' && styles.filterTabTextActive]}>
            All
          </Text>
        </TouchableOpacity>
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.filterTab, filter === c.key && styles.filterTabActive]}
            onPress={() => setFilter(c.key)}
          >
            <Text style={[styles.filterTabText, filter === c.key && styles.filterTabTextActive]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Post list */}
      <FlatList
        data={displayed}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No posts yet. Be the first to share!</Text>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Create post modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Post</Text>

            {/* Category picker */}
            <View style={styles.categoryRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[
                    styles.categoryChip,
                    form.category === c.key && styles.categoryChipActive,
                  ]}
                  onPress={() => setForm((f) => ({ ...f, category: c.key }))}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      form.category === c.key && styles.categoryChipTextActive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Title"
              value={form.title}
              onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What's on your mind?"
              value={form.body}
              onChangeText={(v) => setForm((f) => ({ ...f, body: v }))}
              multiline
              numberOfLines={4}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setForm(EMPTY_FORM);
                  setModalVisible(false);
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={handleCreate}>
                <Text style={styles.submitBtnText}>Post</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function categoryLabel(cat: PostCategory): string {
  switch (cat) {
    case 'forum':
      return '💬 Forum';
    case 'tip':
      return '💡 Tip';
    case 'app':
      return '📱 App';
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  filterRow: {
    maxHeight: 52,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterContent: { paddingHorizontal: 12, paddingVertical: 8 },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  forumNavBtn: {
    padding: 12,
    backgroundColor: '#4A90E2',
    margin: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  forumNavText: { color: '#fff', fontWeight: '700' },
  filterTabActive: { backgroundColor: '#4A90E2' },
  filterTabText: { fontSize: 13, color: '#555' },
  filterTabTextActive: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  categoryBadge: { fontSize: 12, color: '#4A90E2', fontWeight: '600' },
  authorText: { fontSize: 12, color: '#999' },
  postTitle: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 6 },
  postBody: { fontSize: 13, color: '#555', lineHeight: 18 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  likeBtn: { flexDirection: 'row', alignItems: 'center' },
  likeBtnText: { fontSize: 14, color: '#555' },
  deleteText: { fontSize: 12, color: '#e74c3c' },
  emptyText: { textAlign: 'center', color: '#aaa', marginTop: 60, fontSize: 14 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4A90E2',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 32 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16, color: '#222' },
  categoryRow: { flexDirection: 'row', marginBottom: 16 },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  categoryChipActive: { backgroundColor: '#4A90E2' },
  categoryChipText: { fontSize: 12, color: '#555' },
  categoryChipTextActive: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', marginTop: 4 },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#555', fontWeight: '600' },
  submitBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '700' },
});

export default CommunityScreen;
