/**
 * PetPhotosScreen
 *
 * Displays a pet's photo gallery and lets the owner upload new photos or
 * delete existing ones.  All photos are processed on-device before upload:
 *   - EXIF metadata (including GPS) is stripped via expo-image-manipulator
 *   - Orientation is baked into the pixels, so the upright image survives
 *   - Images are downscaled (never upscaled) and compressed to the selected
 *     quality level, then verified before the upload starts
 *   - Files outside `photoService.PHOTO_LIMITS` are rejected on-device
 *
 * ### #964 — Cancellable upload with resumable progress
 *
 * The upload button switches to a progress bar + "Cancel" button while an
 * upload is in progress.  The caller holds an `UploadHandle` returned by
 * `photoService.uploadPhoto`; tapping "Cancel" calls `handle.abort()` which
 * cancels the in-flight XHR.  The upload promise rejects with an
 * `UploadCancelledError` which is caught and shown as a dismissible message
 * rather than an error alert.
 *
 * A SHA-256 checksum is sent with every upload so that the server can
 * de-duplicate retries without storing duplicate photos.
 *
 * The metered-network policy is opt-in: a "Use Mobile Data" toggle is shown
 * in the quality row.  By default, uploads are blocked on metered connections.
 *
 * Platform notes:
 *  - Progress events work on both iOS and Android via the XHR-based upload
 *    in photoService.
 *  - The cancel button is always visible while uploading on both platforms.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import { OptimizedImage } from '../components/OptimizedImage';
import photoService, {
  UploadCancelledError,
  type PetPhoto,
  type PhotoQuality,
  type UploadHandle,
} from '../services/photoService';
import { logError } from '../utils/errorLogger';

const PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  petId: string;
  petName: string;
  onBack: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const PetPhotosScreen: React.FC<Props> = ({ petId, petName, onBack }) => {
  const [photos, setPhotos] = useState<PetPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  // ── Upload state ───────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  /** 0–1 fraction; null means indeterminate (processing phase) */
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadHandleRef = useRef<UploadHandle | null>(null);

  const [selectedPhoto, setSelectedPhoto] = useState<PetPhoto | null>(null);
  const [quality, setQuality] = useState<PhotoQuality>('medium');
  /** When false, uploads are blocked on metered (mobile-data) connections */
  const [allowMetered, setAllowMetered] = useState(false);

  // ── Load photos (paginated) ────────────────────────────────────────────────
  const loadPhotos = useCallback(
    async (reset = false) => {
      if (!reset && (!hasMore || loadingMore)) return;
      const page = reset ? 0 : pageRef.current;
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const slice = await photoService.listPhotos(petId, { page, limit: PAGE_SIZE });
        setPhotos((prev) => (reset ? slice : [...prev, ...slice]));
        setHasMore(slice.length === PAGE_SIZE);
        pageRef.current = page + 1;
      } catch (err) {
        logError(err instanceof Error ? err : new Error(String(err)), {
          screen: 'PetPhotosScreen',
          action: 'loadPhotos',
          petId,
        });
        Alert.alert('Error', 'Failed to load photos. Please try again.');
      } finally {
        if (reset) {
          setLoading(false);
        } else {
          setLoadingMore(false);
        }
      }
    },
    [petId, hasMore, loadingMore],
  );

  useEffect(() => {
    void loadPhotos(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId]);

  // Prefetch next page when 5 items from end
  const handleEndReached = useCallback(() => {
    if (hasMore && !loadingMore) void loadPhotos();
  }, [hasMore, loadingMore, loadPhotos]);

  // ── Cancel an in-flight upload ─────────────────────────────────────────────
  const handleCancelUpload = useCallback(() => {
    uploadHandleRef.current?.abort();
  }, []);

  // ── Upload a new photo ─────────────────────────────────────────────────────
  const handleUpload = useCallback(() => {
    launchImageLibrary({ mediaType: 'photo', quality: 1 }, async (response) => {
      if (response.didCancel || response.errorMessage || !response.assets?.[0]) return;

      const asset = response.assets[0];
      if (!asset.uri) return;

      setUploading(true);
      setUploadProgress(null); // indeterminate while processing

      const handle = photoService.uploadPhoto({
        petId,
        localUri: asset.uri,
        quality,
        allowMetered,
        onProgress: (fraction) => {
          setUploadProgress(fraction);
        },
      });

      uploadHandleRef.current = handle;

      try {
        await handle.promise;
        await loadPhotos(true);
        // Announce success to screen readers
        AccessibilityInfo.announceForAccessibility('Photo uploaded successfully.');
      } catch (err) {
        if (err instanceof UploadCancelledError) {
          // User deliberately cancelled — show a non-intrusive message
          AccessibilityInfo.announceForAccessibility('Upload cancelled.');
        } else {
          logError(err instanceof Error ? err : new Error(String(err)), {
            screen: 'PetPhotosScreen',
            action: 'uploadPhoto',
            petId,
          });
          Alert.alert(
            'Upload Failed',
            err instanceof Error ? err.message : 'Could not upload the photo. Please try again.',
          );
        }
      } finally {
        setUploading(false);
        setUploadProgress(null);
        uploadHandleRef.current = null;
      }
    });
  }, [petId, quality, allowMetered, loadPhotos]);

  // ── Delete a photo ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    (photo: PetPhoto) => {
      Alert.alert('Delete Photo', 'Remove this photo permanently?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await photoService.deletePhoto(photo.id);
              setSelectedPhoto(null);
              await loadPhotos(true);
            } catch (err) {
              logError(err instanceof Error ? err : new Error(String(err)), {
                screen: 'PetPhotosScreen',
                action: 'deletePhoto',
                photoId: photo.id,
              });
              Alert.alert('Error', 'Failed to delete photo. Please try again.');
            }
          },
        },
      ]);
    },
    [loadPhotos],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  const renderUploadArea = () => {
    if (uploading) {
      return (
        <View
          style={styles.uploadProgressContainer}
          accessible
          accessibilityLabel={
            uploadProgress !== null
              ? `Uploading photo, ${Math.round(uploadProgress * 100)} percent complete`
              : 'Processing photo, please wait'
          }
          accessibilityRole="progressbar"
          accessibilityValue={
            uploadProgress !== null
              ? { min: 0, max: 100, now: Math.round(uploadProgress * 100) }
              : undefined
          }
        >
          <View style={styles.uploadProgressRow}>
            {uploadProgress !== null ? (
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.round(uploadProgress * 100)}%` },
                  ]}
                />
              </View>
            ) : (
              <ActivityIndicator color="#4A90E2" size="small" />
            )}
            <Text style={styles.uploadProgressText}>
              {uploadProgress !== null ? `${Math.round(uploadProgress * 100)}%` : 'Processing…'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.cancelUploadBtn}
            onPress={handleCancelUpload}
            accessibilityRole="button"
            accessibilityLabel="Cancel upload"
          >
            <Text style={styles.cancelUploadText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <TouchableOpacity
        style={styles.uploadBtn}
        onPress={handleUpload}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel="Add photo"
      >
        <Text style={styles.uploadBtnText}>+ Add Photo</Text>
      </TouchableOpacity>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} accessibilityRole="button">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">
          {petName}'s Photos
        </Text>
        <View style={styles.headerRight} />
      </View>

      {/* Quality picker + metered-network toggle */}
      <View style={styles.qualityRow}>
        <Text style={styles.qualityLabel}>Quality:</Text>
        {(['high', 'medium', 'low'] as PhotoQuality[]).map((q) => (
          <TouchableOpacity
            key={q}
            style={[styles.qualityBtn, quality === q && styles.qualityBtnActive]}
            onPress={() => setQuality(q)}
            accessibilityRole="radio"
            accessibilityState={{ selected: quality === q }}
            accessibilityLabel={`${q} quality`}
          >
            <Text style={[styles.qualityBtnText, quality === q && styles.qualityBtnTextActive]}>
              {q.charAt(0).toUpperCase() + q.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
        {/* Metered-network opt-in */}
        <View style={styles.meteredRow}>
          <Text style={styles.meteredLabel}>Mobile data</Text>
          <Switch
            value={allowMetered}
            onValueChange={setAllowMetered}
            accessibilityLabel="Allow uploads over mobile data"
            accessibilityRole="switch"
          />
        </View>
      </View>

      {/* Upload area */}
      <View style={styles.uploadArea}>{renderUploadArea()}</View>

      {uploading && uploadProgress === null && (
        <Text style={styles.uploadingHint}>Stripping EXIF data and compressing…</Text>
      )}

      {/* Photo grid */}
      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#4A90E2" />
      ) : photos.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No photos yet.</Text>
          <Text style={styles.emptySubtext}>Tap "+ Add Photo" to upload the first one.</Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.grid}
          onEndReachedThreshold={5 / PAGE_SIZE}
          onEndReached={handleEndReached}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.loader} color="#4A90E2" /> : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.thumb}
              onPress={() => setSelectedPhoto(item)}
              accessibilityRole="button"
              accessibilityLabel={item.caption ?? 'Pet photo'}
            >
              <OptimizedImage
                uri={item.url}
                thumbnailUri={item.thumbnailUrl}
                useThumbnailFirst
                style={styles.thumbImage}
              />
            </TouchableOpacity>
          )}
        />
      )}

      {/* Full-screen photo viewer modal */}
      <Modal
        visible={selectedPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalClose}
            onPress={() => setSelectedPhoto(null)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <Text style={styles.modalCloseText}>✕</Text>
          </Pressable>

          {selectedPhoto && (
            <>
              <Image
                source={{ uri: selectedPhoto.url }}
                style={styles.fullImage}
                resizeMode="contain"
                accessibilityLabel={selectedPhoto.caption ?? 'Full-size pet photo'}
              />
              {selectedPhoto.caption && <Text style={styles.caption}>{selectedPhoto.caption}</Text>}
              <Text style={styles.photoMeta}>
                {new Date(selectedPhoto.uploadedAt).toLocaleDateString()} ·{' '}
                {Math.round(selectedPhoto.sizeBytes / 1024)} KB
              </Text>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDelete(selectedPhoto)}
                accessibilityRole="button"
                accessibilityLabel="Delete this photo"
              >
                <Text style={styles.deleteBtnText}>Delete Photo</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const THUMB_SIZE = '33%' as const;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  backButton: { minWidth: 60 },
  backText: { fontSize: 17, color: '#4A90E2' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  headerRight: { minWidth: 60 },

  // Quality picker + metered toggle
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    gap: 8,
    flexWrap: 'wrap',
  },
  qualityLabel: { fontSize: 14, color: '#666', marginRight: 4 },
  qualityBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: '#fff',
  },
  qualityBtnActive: { borderColor: '#4A90E2', backgroundColor: '#EAF2FF' },
  qualityBtnText: { fontSize: 13, color: '#555' },
  qualityBtnTextActive: { color: '#4A90E2', fontWeight: '600' },
  meteredRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', gap: 6 },
  meteredLabel: { fontSize: 12, color: '#888' },

  // Upload area
  uploadArea: { marginHorizontal: 16, marginVertical: 12 },
  uploadBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
  },
  uploadBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Upload-in-progress UI
  uploadProgressContainer: {
    borderRadius: 10,
    backgroundColor: '#EAF2FF',
    padding: 12,
    gap: 8,
  },
  uploadProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#c8dff8',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 8,
    backgroundColor: '#4A90E2',
    borderRadius: 4,
  },
  uploadProgressText: { fontSize: 13, fontWeight: '600', color: '#4A90E2', minWidth: 40 },
  cancelUploadBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4A90E2',
    backgroundColor: '#fff',
  },
  cancelUploadText: { fontSize: 13, fontWeight: '600', color: '#4A90E2' },

  uploadingHint: { textAlign: 'center', fontSize: 12, color: '#888', marginBottom: 8 },

  // Grid
  loader: { marginTop: 60 },
  grid: { padding: 2 },
  thumb: {
    width: THUMB_SIZE,
    aspectRatio: 1,
    margin: 1,
    backgroundColor: '#e0e0e0',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { fontSize: 17, fontWeight: '600', color: '#555', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#999', textAlign: 'center' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalClose: { position: 'absolute', top: 52, right: 20, padding: 10, zIndex: 10 },
  modalCloseText: { fontSize: 22, color: '#fff' },
  fullImage: { width: '100%', height: '70%', borderRadius: 8 },
  caption: { marginTop: 12, fontSize: 15, color: '#eee', textAlign: 'center' },
  photoMeta: { marginTop: 6, fontSize: 12, color: '#aaa' },
  deleteBtn: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e53935',
  },
  deleteBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});

export default PetPhotosScreen;
