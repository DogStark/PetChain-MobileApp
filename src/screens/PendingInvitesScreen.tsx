/**
 * PendingInvitesScreen — shows all pending co-owner invites for the current user.
 * Users can accept or decline each invite from here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import multisigService from '../services/multisigService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingInvite {
  id: string;
  petId: string;
  petName: string;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onInviteAccepted: (petId: string) => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const PendingInvitesScreen: React.FC<Props> = ({ onBack, onInviteAccepted }) => {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await multisigService.getPendingInvites();
      setInvites(data);
    } catch {
      Alert.alert('Error', 'Failed to load pending invites.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = useCallback(
    (invite: PendingInvite) => {
      Alert.alert(
        'Accept Invite',
        `Join as co-owner of ${invite.petName}?\n\nInvited by: ${invite.invitedByName}\n\nYou will be added as a Stellar signer and must co-sign critical operations.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Accept',
            onPress: async () => {
              setProcessingId(invite.id);
              try {
                await multisigService.acceptCoOwnerInvite(invite.id);
                Alert.alert(
                  'Invite Accepted',
                  `You are now a co-owner of ${invite.petName}. Your Stellar key has been added to the multisig account.`,
                  [{ text: 'OK', onPress: () => onInviteAccepted(invite.petId) }],
                );
                void load(true);
              } catch (error: any) {
                Alert.alert('Error', error?.message ?? 'Failed to accept invite.');
              } finally {
                setProcessingId(null);
              }
            },
          },
        ],
      );
    },
    [load, onInviteAccepted],
  );

  const handleDecline = useCallback(
    (invite: PendingInvite) => {
      Alert.alert('Decline Invite', `Decline co-ownership invite for ${invite.petName}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setProcessingId(invite.id);
            try {
              await multisigService.declineCoOwnerInvite(invite.id);
              void load(true);
            } catch (error: any) {
              Alert.alert('Error', error?.message ?? 'Failed to decline invite.');
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]);
    },
    [load],
  );

  const renderItem = ({ item }: { item: PendingInvite }) => {
    const expiresAt = new Date(item.expiresAt);
    const isExpiringSoon = expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000;
    const isProcessing = processingId === item.id;

    return (
      <View style={styles.card}>
        {/* Pet info */}
        <View style={styles.cardHeader}>
          <View style={styles.petAvatar}>
            <Text style={styles.petAvatarEmoji}>🐾</Text>
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.petName}>{item.petName}</Text>
            <Text style={styles.invitedBy}>Invited by {item.invitedByName}</Text>
            <Text style={styles.inviteDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
          </View>
          <View style={styles.multisigBadge}>
            <Text style={styles.multisigBadgeText}>⛓ Multisig</Text>
          </View>
        </View>

        {/* Expiry */}
        <View style={[styles.expiryRow, isExpiringSoon && styles.expiryRowWarn]}>
          <Text style={[styles.expiryText, isExpiringSoon && styles.expiryTextWarn]}>
            {isExpiringSoon ? '⏰ ' : '📅 '}
            Expires {expiresAt.toLocaleDateString()} at{' '}
            {expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        {/* What this means */}
        <Text style={styles.infoText}>
          Accepting makes you a Stellar co-signer. Critical operations (ownership transfers, record
          deletions) will require your signature.
        </Text>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.declineBtn, isProcessing && styles.btnDisabled]}
            onPress={() => handleDecline(item)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#F44336" />
            ) : (
              <Text style={styles.declineBtnText}>Decline</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.acceptBtn, isProcessing && styles.btnDisabled]}
            onPress={() => handleAccept(item)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.acceptBtnText}>Accept & Join</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Co-Owner Invites</Text>
        {invites.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{invites.length}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(true);
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>✉️</Text>
              <Text style={styles.emptyTitle}>No Pending Invites</Text>
              <Text style={styles.emptySubtitle}>
                When someone invites you to co-own a pet, it will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 10,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', flex: 1 },
  badge: {
    backgroundColor: '#F44336',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 10,
  },
  petAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e8f5e9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  petAvatarEmoji: { fontSize: 22 },
  cardHeaderText: { flex: 1 },
  petName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  invitedBy: { fontSize: 13, color: '#666', marginTop: 2 },
  inviteDate: { fontSize: 11, color: '#999', marginTop: 2 },
  multisigBadge: {
    backgroundColor: '#1565c0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  multisigBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  expiryRow: {
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
  },
  expiryRowWarn: { backgroundColor: '#fff8e1' },
  expiryText: { fontSize: 12, color: '#666' },
  expiryTextWarn: { color: '#f57f17', fontWeight: '600' },
  infoText: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    marginBottom: 14,
  },
  actions: { flexDirection: 'row', gap: 10 },
  declineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#F44336',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  declineBtnText: { color: '#F44336', fontWeight: '600', fontSize: 14 },
  acceptBtn: {
    flex: 2,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
});

export default PendingInvitesScreen;
