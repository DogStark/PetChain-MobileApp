import React, { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { OptimizedImage } from './OptimizedImage';
import type { MedicalDocumentMetadata } from '../models/MedicalRecord';
import {
  formatFileSize,
  getAttachmentLabel,
  isImageDocument,
  isPdfDocument,
  normalizeDocuments,
} from '../utils/medicalRecordAttachments';

interface Props {
  documents?: MedicalDocumentMetadata[] | null;
}

/** Seconds before expiry at which we proactively refresh the signed URL (5 min). */
const REFRESH_THRESHOLD_S = 300;

function getExpiryFromUrl(url: string): number | null {
  try {
    const expires = new URL(url).searchParams.get('expires');
    return expires ? Number(expires) : null;
  } catch {
    return null;
  }
}

function isExpiringSoon(url: string): boolean {
  const expires = getExpiryFromUrl(url);
  if (expires === null) return false; // unsigned URL — not managed here
  return expires - Date.now() / 1000 < REFRESH_THRESHOLD_S;
}

async function reissueSignedUrl(storageKey: string): Promise<string | null> {
  try {
    const { default: apiClient } = await import('../services/apiClient');
    const resp = await apiClient.post<{ signedUrl: string }>(
      '/medical-records/attachments/signed-url',
      { key: storageKey },
    );
    return resp.data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function openDocument(url: string): void {
  void Linking.openURL(url).catch(() => {
    Alert.alert('Unable to open attachment', 'Please try again or copy the link into a browser.');
  });
}

/**
 * Resolves the display URL for a document, refreshing the signed URL if it is
 * about to expire. Returns the current URL (possibly refreshed) and a stable key.
 */
function useSignedUrl(doc: MedicalDocumentMetadata): string {
  const [url, setUrl] = useState(doc.url);

  useEffect(() => {
    let cancelled = false;
    if (isExpiringSoon(doc.url)) {
      const storageKey = doc.url.split('?')[0].replace(/^https?:\/\/[^/]+\//, '');
      void reissueSignedUrl(storageKey).then((fresh) => {
        if (!cancelled && fresh) setUrl(fresh);
      });
    } else {
      setUrl(doc.url);
    }
    return () => {
      cancelled = true;
    };
  }, [doc.url]);

  return url;
}

interface AttachmentCardProps {
  document: MedicalDocumentMetadata;
}

const AttachmentCard: React.FC<AttachmentCardProps> = ({ document }) => {
  const resolvedUrl = useSignedUrl(document);

  const description = [
    getAttachmentLabel(document),
    formatFileSize(document.sizeBytes),
    document.mimeType,
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <TouchableOpacity
      key={document.id || document.url}
      style={styles.card}
      onPress={() => openDocument(resolvedUrl)}
      accessibilityRole="button"
      accessibilityLabel={`${document.name}, ${description}`}
      accessibilityHint="Opens the attachment"
    >
      {isImageDocument(document) ? (
        <OptimizedImage
          uri={resolvedUrl}
          style={styles.preview}
          resizeMode="cover"
          accessibilityLabel={document.name}
        />
      ) : (
        <View style={[styles.preview, styles.filePreview]}>
          <Text style={styles.fileIcon}>{isPdfDocument(document) ? 'PDF' : 'DOC'}</Text>
        </View>
      )}
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={2}>
          {document.name}
        </Text>
        <Text style={styles.details} numberOfLines={2}>
          {description}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export const MedicalRecordAttachments: React.FC<Props> = ({ documents }) => {
  const attachments = normalizeDocuments(documents);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Attachments</Text>
      <View style={styles.grid}>
        {attachments.map((document) => (
          <AttachmentCard key={document.id || document.url} document={document} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: 8,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  grid: {
    marginBottom: -12,
  },
  card: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
  },
  preview: {
    width: '100%',
    height: 180,
    backgroundColor: '#EEF2F7',
  },
  filePreview: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileIcon: {
    fontSize: 30,
    fontWeight: '800',
    color: '#374151',
    letterSpacing: 1,
  },
  meta: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  details: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
  },
});

export default MedicalRecordAttachments;
