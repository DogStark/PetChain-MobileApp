import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { DocumentReviewStatus } from '../services/documentService';

export type AttachmentReviewDisplayStatus = DocumentReviewStatus | 'uploading' | 'unknown';

const STATE_COPY: Record<AttachmentReviewDisplayStatus, { label: string; guidance: string }> = {
  unknown: {
    label: 'Review status unavailable',
    guidance: 'Refresh the document list to check the latest review status.',
  },
  uploading: {
    label: 'Uploading',
    guidance: 'Keep this screen open until the secure upload completes.',
  },
  pending_review: {
    label: 'Pending clinician review',
    guidance: 'Your attachment was submitted and is waiting for clinician review.',
  },
  accepted: {
    label: 'Accepted',
    guidance: 'A clinician accepted this attachment.',
  },
  rejected: {
    label: 'Rejected',
    guidance: 'This attachment was not accepted. Replace it and submit it for review again.',
  },
  expired: {
    label: 'Expired',
    guidance: 'This review has expired. Replace the attachment to request a new review.',
  },
};

interface Props {
  status?: AttachmentReviewDisplayStatus;
}

export default function AttachmentReviewState({ status }: Props) {
  const copy = STATE_COPY[status ?? 'unknown'];

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Text style={styles.label} accessibilityRole="text">
        Review status: {copy.label}
      </Text>
      <Text style={styles.guidance}>{copy.guidance}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  label: {
    color: '#1f2937',
    fontSize: 12,
    fontWeight: '700',
  },
  guidance: {
    color: '#4b5563',
    fontSize: 12,
    marginTop: 2,
  },
});
