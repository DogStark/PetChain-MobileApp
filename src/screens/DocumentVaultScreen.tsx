import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  type DocumentCategory,
  type DocumentMeta,
  type QuotaInfo,
  captureDocumentPhoto,
  deleteDocument,
  getDocumentVersions,
  listDocuments,
  pickDocument,
  restoreDocument,
  saveDocumentLocally,
  uploadDocument,
} from '../services/documentService';
import { EmptyState } from '../components/EmptyState';
import { useSecureScreen } from '../utils/secureScreen';
import api from '../services/api';

const CATEGORIES: { label: string; value: DocumentCategory }[] = [
  { label: 'Vaccination', value: 'vaccination' },
  { label: 'Insurance', value: 'insurance' },
  { label: 'Vet Report', value: 'vet_report' },
  { label: 'Other', value: 'other' },
];

interface DocumentVaultScreenProps {
  petId?: string;
  ownerId?: string;
}

const DocumentVaultScreen: React.FC<DocumentVaultScreenProps> = ({
  petId: initialPetId = '',
  ownerId = '',
}) => {
  useSecureScreen();

  const [petId, setPetId] = useState(initialPetId);
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [filterCategory, setFilterCategory] = useState<DocumentCategory | ''>('');
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  // Upload modal state
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>('other');
  const [pendingFile, setPendingFile] = useState<{
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  } | null>(null);

  // Version history modal
  const [versionsModalVisible, setVersionsModalVisible] = useState(false);
  const [versions, setVersions] = useState<DocumentMeta[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentMeta | null>(null);

  // Health report async job state
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [reportJobStatus, setReportJobStatus] = useState<
    'idle' | 'queued' | 'processing' | 'complete' | 'failed'
  >('idle');
  const reportPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopReportPolling = useCallback(() => {
    if (reportPollRef.current) {
      clearInterval(reportPollRef.current);
      reportPollRef.current = null;
    }
  }, []);

  const handleGenerateReport = useCallback(async () => {
    if (!petId.trim()) return Alert.alert('Error', 'Enter a Pet ID first');
    setReportJobStatus('queued');
    setReportJobId(null);
    try {
      const res = await api.post<{ jobId: string }>(
        `/reports/pets/${petId.trim()}/health`,
      );
      const jobId = res.data?.jobId;
      if (!jobId) throw new Error('No jobId returned');
      setReportJobId(jobId);

      // Poll every 2 seconds until complete or failed
      reportPollRef.current = setInterval(async () => {
        try {
          const statusRes = await api.get<{
            status: 'queued' | 'processing' | 'complete' | 'failed';
          }>(`/reports/${jobId}/status`);
          const status = statusRes.data?.status ?? 'queued';
          setReportJobStatus(status);
          if (status === 'complete' || status === 'failed') {
            stopReportPolling();
          }
        } catch {
          stopReportPolling();
          setReportJobStatus('failed');
        }
      }, 2000);
    } catch (err) {
      setReportJobStatus('failed');
      Alert.alert('Report Error', err instanceof Error ? err.message : 'Failed to start report');
    }
  }, [petId, stopReportPolling]);

  useEffect(() => () => stopReportPolling(), [stopReportPolling]);

  const loadDocuments = useCallback(async () => {
    if (!petId.trim()) return;
    setLoading(true);
    try {
      const docs = await listDocuments(petId.trim(), {
        category: filterCategory || undefined,
        includeDeleted,
      });
      setDocuments(docs);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [petId, filterCategory, includeDeleted]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handlePickFile = async () => {
    try {
      const file = await pickDocument();
      if (!file) return;
      setPendingFile(file);
      setUploadName(file.name);
      setUploadModalVisible(true);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to pick file');
    }
  };

  const handleCapturePhoto = async () => {
    try {
      const file = await captureDocumentPhoto();
      if (!file) return;
      setPendingFile(file);
      setUploadName(file.name);
      setUploadModalVisible(true);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to capture photo');
    }
  };

  const handleUpload = async (parentId?: string) => {
    if (!pendingFile || !uploadName.trim() || !petId.trim()) return;
    setUploading(true);
    try {
      await uploadDocument({
        petId: petId.trim(),
        name: uploadName.trim(),
        category: uploadCategory,
        uri: pendingFile.uri,
        mimeType: pendingFile.mimeType,
        parentId,
      });
      setUploadModalVisible(false);
      setPendingFile(null);
      setUploadName('');
      await loadDocuments();
    } catch (err) {
      Alert.alert('Upload Failed', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: DocumentMeta) => {
    try {
      const localUri = await saveDocumentLocally(doc.id, doc.name);
      Alert.alert('Downloaded', `Saved to: ${localUri}`);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleDelete = (doc: DocumentMeta) => {
    Alert.alert('Delete Document', `Delete "${doc.name}"? It can be restored later.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDocument(doc.id);
            await loadDocuments();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Delete failed');
          }
        },
      },
    ]);
  };

  const handleRestore = async (doc: DocumentMeta) => {
    try {
      await restoreDocument(doc.id);
      await loadDocuments();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Restore failed');
    }
  };

  const handleViewVersions = async (doc: DocumentMeta) => {
    try {
      const versionList = await getDocumentVersions(doc.id);
      setVersions(versionList);
      setSelectedDoc(doc);
      setVersionsModalVisible(true);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to load versions');
    }
  };

  const handleUploadNewVersion = (doc: DocumentMeta) => {
    setSelectedDoc(doc);
    setUploadName(doc.name);
    setUploadCategory(doc.category);
    setVersionsModalVisible(false);
    // Trigger file picker for new version
    pickDocument()
      .then((file) => {
        if (!file) return;
        setPendingFile(file);
        setUploadModalVisible(true);
      })
      .catch((err) => Alert.alert('Error', err instanceof Error ? err.message : 'Failed'));
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderDocument = ({ item }: { item: DocumentMeta }) => (
    <View style={[styles.docCard, item.deletedAt ? styles.deletedCard : null]}>
      <View style={styles.docInfo}>
        <Text style={styles.docName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.docMeta}>
          {item.category} · v{item.version} · {formatBytes(item.sizeBytes)}
        </Text>
        <Text style={styles.docDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
        {item.deletedAt && <Text style={styles.deletedLabel}>Deleted</Text>}
      </View>
      <View style={styles.docActions}>
        {!item.deletedAt ? (
          <>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleDownload(item)}
              accessibilityLabel={`Download ${item.name}`}
            >
              <Text style={styles.actionText}>↓</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleViewVersions(item)}
              accessibilityLabel={`View versions of ${item.name}`}
            >
              <Text style={styles.actionText}>⏱</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={() => handleDelete(item)}
              accessibilityLabel={`Delete ${item.name}`}
            >
              <Text style={styles.actionText}>🗑</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, styles.restoreBtn]}
            onPress={() => handleRestore(item)}
            accessibilityLabel={`Restore ${item.name}`}
          >
            <Text style={styles.actionText}>↩</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Pet ID input */}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Pet ID"
          value={petId}
          onChangeText={setPetId}
          onSubmitEditing={loadDocuments}
          accessibilityLabel="Pet ID input"
        />
        <TouchableOpacity style={styles.refreshBtn} onPress={loadDocuments}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, !filterCategory && styles.filterChipActive]}
          onPress={() => setFilterCategory('')}
        >
          <Text style={styles.filterChipText}>All</Text>
        </TouchableOpacity>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.value}
            style={[styles.filterChip, filterCategory === cat.value && styles.filterChipActive]}
            onPress={() => setFilterCategory(cat.value)}
          >
            <Text style={styles.filterChipText}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Show deleted toggle */}
      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => setIncludeDeleted((v) => !v)}
        accessibilityLabel="Toggle show deleted documents"
      >
        <Text style={styles.toggleText}>
          {includeDeleted ? '✓ Showing deleted' : 'Show deleted'}
        </Text>
      </TouchableOpacity>

      {/* Quota */}
      {quota && (
        <View style={styles.quotaBar}>
          <Text style={styles.quotaText}>
            Storage: {formatBytes(quota.used)} / {formatBytes(quota.limit)}
          </Text>
          <View style={styles.quotaTrack}>
            <View
              style={[
                styles.quotaFill,
                { width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` },
              ]}
            />
          </View>
        </View>
      )}

      {/* Document list */}
      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" />
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(item) => item.id}
          renderItem={renderDocument}
          ListEmptyComponent={
            <EmptyState
              icon="folder-open"
              title="Vault is Empty"
              description="Securely store vaccination records, lab results, and insurance documents."
              buttonText="Upload document"
              onPress={handlePickFile}
            />
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Upload buttons */}
      <View style={styles.uploadRow}>
        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={handlePickFile}
          accessibilityLabel="Pick document from files"
        >
          <Text style={styles.uploadBtnText}>📄 File</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={handleCapturePhoto}
          accessibilityLabel="Capture document with camera"
        >
          <Text style={styles.uploadBtnText}>📷 Camera</Text>
        </TouchableOpacity>
      </View>

      {/* Health Report async generation */}
      <View style={styles.reportRow}>
        <TouchableOpacity
          style={[
            styles.reportBtn,
            (reportJobStatus === 'queued' || reportJobStatus === 'processing') &&
              styles.disabledBtn,
          ]}
          onPress={handleGenerateReport}
          disabled={reportJobStatus === 'queued' || reportJobStatus === 'processing'}
          accessibilityLabel="Generate health report"
        >
          {reportJobStatus === 'queued' || reportJobStatus === 'processing' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.reportBtnText}>
                {reportJobStatus === 'queued' ? 'Queued…' : 'Generating…'}
              </Text>
            </View>
          ) : (
            <Text style={styles.reportBtnText}>📊 Generate Health Report</Text>
          )}
        </TouchableOpacity>
        {reportJobStatus === 'complete' && reportJobId && (
          <TouchableOpacity
            style={styles.downloadReportBtn}
            onPress={() =>
              Alert.alert('Report Ready', `Download at: /api/reports/${reportJobId}/download`)
            }
            accessibilityLabel="Download completed health report"
          >
            <Text style={styles.reportBtnText}>⬇ Download PDF</Text>
          </TouchableOpacity>
        )}
        {reportJobStatus === 'failed' && (
          <Text style={styles.reportError}>Report generation failed. Tap above to retry.</Text>
        )}
      </View>

      {/* Upload modal */}
      <Modal
        visible={uploadModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setUploadModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Upload Document</Text>
            <TextInput
              style={styles.input}
              placeholder="Document name"
              value={uploadName}
              onChangeText={setUploadName}
              accessibilityLabel="Document name input"
            />
            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.value}
                  style={[
                    styles.filterChip,
                    uploadCategory === cat.value && styles.filterChipActive,
                  ]}
                  onPress={() => setUploadCategory(cat.value)}
                >
                  <Text style={styles.filterChipText}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {pendingFile && (
              <Text style={styles.fileInfo}>
                {pendingFile.name} ({formatBytes(pendingFile.size)})
              </Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setUploadModalVisible(false);
                  setPendingFile(null);
                }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, uploading && styles.disabledBtn]}
                onPress={() => handleUpload(selectedDoc?.id)}
                disabled={uploading}
                accessibilityLabel="Confirm upload"
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmText}>Upload</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Version history modal */}
      <Modal
        visible={versionsModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setVersionsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Version History</Text>
            <Text style={styles.docName}>{selectedDoc?.name}</Text>
            <FlatList
              data={versions}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.versionRow}>
                  <Text style={styles.versionText}>
                    v{item.version} · {new Date(item.createdAt).toLocaleDateString()} ·{' '}
                    {formatBytes(item.sizeBytes)}
                  </Text>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleDownload(item)}
                    accessibilityLabel={`Download version ${item.version}`}
                  >
                    <Text style={styles.actionText}>↓</Text>
                  </TouchableOpacity>
                </View>
              )}
              style={styles.versionList}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setVersionsModalVisible(false);
                  setSelectedDoc(null);
                }}
              >
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
              {selectedDoc && (
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={() => handleUploadNewVersion(selectedDoc)}
                  accessibilityLabel="Upload new version"
                >
                  <Text style={styles.confirmText}>New Version</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
    fontSize: 14,
  },
  refreshBtn: { marginLeft: 8, padding: 10 },
  refreshText: { fontSize: 20 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, gap: 6 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#e0e0e0',
  },
  filterChipActive: { backgroundColor: '#4a90e2' },
  filterChipText: { fontSize: 12, color: '#333' },
  toggleRow: { marginBottom: 8 },
  toggleText: { fontSize: 13, color: '#4a90e2' },
  quotaBar: { marginBottom: 12 },
  quotaText: { fontSize: 12, color: '#666', marginBottom: 4 },
  quotaTrack: { height: 6, backgroundColor: '#e0e0e0', borderRadius: 3 },
  quotaFill: { height: 6, backgroundColor: '#4a90e2', borderRadius: 3 },
  loader: { marginTop: 40 },
  listContent: { paddingBottom: 80 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 14 },
  docCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  deletedCard: { opacity: 0.6, borderLeftWidth: 3, borderLeftColor: '#e74c3c' },
  docInfo: { flex: 1 },
  docName: { fontSize: 14, fontWeight: '600', color: '#222' },
  docMeta: { fontSize: 12, color: '#666', marginTop: 2 },
  docDate: { fontSize: 11, color: '#999', marginTop: 2 },
  deletedLabel: { fontSize: 11, color: '#e74c3c', marginTop: 2 },
  docActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: { backgroundColor: '#fde8e8' },
  restoreBtn: { backgroundColor: '#e8f5e9' },
  actionText: { fontSize: 14 },
  uploadRow: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 12,
  },
  uploadBtn: {
    flex: 1,
    backgroundColor: '#4a90e2',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  uploadBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16, color: '#222' },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 8 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  fileInfo: { fontSize: 12, color: '#666', marginBottom: 12 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  cancelText: { color: '#666', fontWeight: '600' },
  confirmBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#4a90e2',
    alignItems: 'center',
  },
  confirmText: { color: '#fff', fontWeight: '600' },
  disabledBtn: { opacity: 0.6 },
  versionList: { maxHeight: 200, marginVertical: 8 },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  versionText: { flex: 1, fontSize: 13, color: '#444' },
  reportRow: { marginTop: 8, gap: 6 },
  reportBtn: {
    backgroundColor: '#6c5ce7',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  downloadReportBtn: {
    backgroundColor: '#00b894',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  reportBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  reportError: { color: '#e53e3e', fontSize: 12, textAlign: 'center', marginTop: 4 },
});

export default DocumentVaultScreen;
