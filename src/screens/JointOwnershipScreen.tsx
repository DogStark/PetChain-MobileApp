/**
 * JointOwnershipScreen — displays multisig status, co-owners, and pending
 * co-sign requests for a jointly-owned pet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import multisigService, {
  type JointOwnershipResponse,
  type PendingTransactionResponse,
  type CoOwnerResponse,
} from '../services/multisigService';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  petId: string;
  petName: string;
  currentUserId: string;
  currentUserPublicKey?: string;
  onBack: () => void;
  onInviteCoOwner: (jointOwnershipId: string) => void;
  onSignTransaction: (transaction: PendingTransactionResponse) => void;
  onInitiateTransfer: (jointOwnershipId: string) => void;
}

// ─── Status badge helpers ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: '#4CAF50',
  pending: '#FF9800',
  revoked: '#9E9E9E',
  approved: '#4CAF50',
  rejected: '#F44336',
  expired: '#9E9E9E',
};

const OP_LABELS: Record<PendingTransactionResponse['operationType'], string> = {
  ownership_transfer: 'Ownership Transfer',
  record_deletion: 'Record Deletion',
  signer_management: 'Signer Change',
};

const OP_ICONS: Record<PendingTransactionResponse['operationType'], string> = {
  ownership_transfer: '🔑',
  record_deletion: '🗑️',
  signer_management: '👤',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? '#9E9E9E' }]}>
    <Text style={styles.badgeText}>{status.toUpperCase()}</Text>
  </View>
);

const CoOwnerRow: React.FC<{ owner: CoOwnerResponse }> = ({ owner }) => (
  <View style={styles.coOwnerRow}>
    <View style={styles.coOwnerAvatar}>
      <Text style={styles.coOwnerInitial}>{owner.name.charAt(0).toUpperCase()}</Text>
    </View>
    <View style={styles.coOwnerInfo}>
      <Text style={styles.coOwnerName}>{owner.name}</Text>
      <Text style={styles.coOwnerEmail}>{owner.email}</Text>
      <Text style={styles.coOwnerKey} numberOfLines={1}>
        {owner.publicKey.substring(0, 12)}…{owner.publicKey.slice(-6)}
      </Text>
    </View>
    <View style={styles.coOwnerRight}>
      <StatusBadge status={owner.status} />
      <Text style={styles.weightLabel}>Weight: {owner.weight}</Text>
    </View>
  </View>
);

const PendingTxCard: React.FC<{
  tx: PendingTransactionResponse;
  currentUserPublicKey?: string;
  onSign: () => void;
  onReject: () => void;
}> = ({ tx, currentUserPublicKey, onSign, onReject }) => {
  const userSigner = tx.signers.find((s) => s.publicKey === currentUserPublicKey);
  const canSign = userSigner && !userSigner.hasSigned && tx.status === 'pending';
  const expiresAt = new Date(tx.expiresAt);
  const isExpiringSoon = expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000;

  return (
    <View style={styles.txCard}>
      <View style={styles.txHeader}>
        <Text style={styles.txIcon}>{OP_ICONS[tx.operationType]}</Text>
        <View style={styles.txHeaderText}>
          <Text style={styles.txOpType}>{OP_LABELS[tx.operationType]}</Text>
          <Text style={styles.txDescription} numberOfLines={2}>
            {tx.description}
          </Text>
        </View>
        <StatusBadge status={tx.status} />
      </View>

      {/* Signature progress */}
      <View style={styles.sigProgress}>
        <Text style={styles.sigProgressLabel}>
          Signatures: {tx.currentSignatureCount} / {tx.requiredSignatures} required
        </Text>
        <View style={styles.sigBar}>
          <View
            style={[
              styles.sigBarFill,
              {
                width: `${Math.min(
                  100,
                  (tx.currentSignatureCount / tx.requiredSignatures) * 100,
                )}%`,
              },
            ]}
          />
        </View>
      </View>

      {/* Signer list */}
      <View style={styles.signerList}>
        {tx.signers.map((s) => (
          <View key={s.publicKey} style={styles.signerItem}>
            <Text style={s.hasSigned ? styles.signerSigned : styles.signerPending}>
              {s.hasSigned ? '✅' : '⏳'} {s.name ?? `${s.publicKey.substring(0, 8)}…`}
            </Text>
            {s.signedAt && (
              <Text style={styles.signerTime}>{new Date(s.signedAt).toLocaleDateString()}</Text>
            )}
          </View>
        ))}
      </View>

      {/* Expiry */}
      <Text style={[styles.expiryText, isExpiringSoon && styles.expiryWarning]}>
        {tx.status === 'pending'
          ? `Expires: ${expiresAt.toLocaleDateString()} ${expiresAt.toLocaleTimeString()}`
          : `${tx.status.charAt(0).toUpperCase() + tx.status.slice(1)} on ${new Date(tx.createdAt).toLocaleDateString()}`}
      </Text>

      {/* Actions */}
      {canSign && (
        <View style={styles.txActions}>
          <TouchableOpacity style={styles.rejectBtn} onPress={onReject}>
            <Text style={styles.rejectBtnText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.signBtn} onPress={onSign}>
            <Text style={styles.signBtnText}>Sign & Approve</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

const JointOwnershipScreen: React.FC<Props> = ({
  petId,
  petName,
  currentUserId,
  currentUserPublicKey,
  onBack,
  onInviteCoOwner,
  onSignTransaction,
  onInitiateTransfer,
}) => {
  const [jointOwnership, setJointOwnership] = useState<JointOwnershipResponse | null>(null);
  const [pendingTxs, setPendingTxs] = useState<PendingTransactionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'pending'>('overview');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const jo = await multisigService.getJointOwnershipByPet(petId);
        setJointOwnership(jo);
        if (jo) {
          const txs = await multisigService.getPendingTransactions(jo.multisigAccountId);
          setPendingTxs(txs);
        }
      } catch {
        Alert.alert('Error', 'Failed to load joint ownership details.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [petId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  const handleRejectTx = useCallback(
    (tx: PendingTransactionResponse) => {
      if (!currentUserPublicKey) return;
      Alert.alert('Reject Transaction', `Are you sure you want to reject "${tx.description}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await multisigService.rejectTransaction(tx.id, currentUserPublicKey);
              void load(true);
            } catch {
              Alert.alert('Error', 'Failed to reject transaction.');
            }
          },
        },
      ]);
    },
    [currentUserPublicKey, load],
  );

  const pendingCount = pendingTxs.filter((t) => t.status === 'pending').length;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Joint Ownership</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Pet name */}
      <View style={styles.petBanner}>
        <Text style={styles.petBannerEmoji}>🐾</Text>
        <Text style={styles.petBannerName}>{petName}</Text>
        {jointOwnership && (
          <View style={styles.multisigBadge}>
            <Text style={styles.multisigBadgeText}>⛓ Multisig</Text>
          </View>
        )}
      </View>

      {!jointOwnership ? (
        /* No joint ownership yet */
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🤝</Text>
          <Text style={styles.emptyTitle}>No Joint Ownership</Text>
          <Text style={styles.emptySubtitle}>
            Set up a Stellar multisig account to share ownership of {petName} with co-owners.
            Critical operations will require M-of-N signatures.
          </Text>
        </View>
      ) : (
        <>
          {/* Tabs */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
              onPress={() => setActiveTab('overview')}
            >
              <Text style={[styles.tabText, activeTab === 'overview' && styles.tabTextActive]}>
                Overview
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'pending' && styles.tabActive]}
              onPress={() => setActiveTab('pending')}
            >
              <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>
                Pending {pendingCount > 0 ? `(${pendingCount})` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          >
            {activeTab === 'overview' ? (
              <OverviewTab
                jointOwnership={jointOwnership}
                currentUserId={currentUserId}
                onInviteCoOwner={() => onInviteCoOwner(jointOwnership.id)}
                onInitiateTransfer={() => onInitiateTransfer(jointOwnership.id)}
              />
            ) : (
              <PendingTab
                transactions={pendingTxs}
                currentUserPublicKey={currentUserPublicKey}
                onSign={onSignTransaction}
                onReject={handleRejectTx}
              />
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
};

// ─── Overview Tab ─────────────────────────────────────────────────────────────

const OverviewTab: React.FC<{
  jointOwnership: JointOwnershipResponse;
  currentUserId: string;
  onInviteCoOwner: () => void;
  onInitiateTransfer: () => void;
}> = ({ jointOwnership, onInviteCoOwner, onInitiateTransfer }) => (
  <View>
    {/* Multisig account info */}
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Stellar Multisig Account</Text>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Public Key</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {jointOwnership.multisigPublicKey.substring(0, 12)}…
          {jointOwnership.multisigPublicKey.slice(-6)}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Required Weight</Text>
        <Text style={styles.rowValue}>
          {jointOwnership.requiredWeight} / {jointOwnership.totalWeight}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Thresholds</Text>
        <Text style={styles.rowValue}>
          L:{jointOwnership.thresholds.low} M:{jointOwnership.thresholds.medium} H:
          {jointOwnership.thresholds.high}
        </Text>
      </View>
    </View>

    {/* Co-owners */}
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardTitle}>Co-Owners ({jointOwnership.coOwners.length})</Text>
        <TouchableOpacity style={styles.inviteBtn} onPress={onInviteCoOwner}>
          <Text style={styles.inviteBtnText}>+ Invite</Text>
        </TouchableOpacity>
      </View>
      {jointOwnership.coOwners.map((owner) => (
        <CoOwnerRow key={owner.publicKey} owner={owner} />
      ))}
    </View>

    {/* Critical operations */}
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Critical Operations</Text>
      <Text style={styles.cardSubtitle}>
        These actions require {jointOwnership.requiredWeight} of {jointOwnership.totalWeight} weight
        in co-signatures before executing on Stellar.
      </Text>
      <TouchableOpacity style={styles.criticalBtn} onPress={onInitiateTransfer}>
        <Text style={styles.criticalBtnIcon}>🔑</Text>
        <View style={styles.criticalBtnText}>
          <Text style={styles.criticalBtnTitle}>Transfer Ownership</Text>
          <Text style={styles.criticalBtnSub}>Requires all co-owner signatures</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    </View>
  </View>
);

// ─── Pending Tab ──────────────────────────────────────────────────────────────

const PendingTab: React.FC<{
  transactions: PendingTransactionResponse[];
  currentUserPublicKey?: string;
  onSign: (tx: PendingTransactionResponse) => void;
  onReject: (tx: PendingTransactionResponse) => void;
}> = ({ transactions, currentUserPublicKey, onSign, onReject }) => {
  if (transactions.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>✅</Text>
        <Text style={styles.emptyTitle}>No Pending Requests</Text>
        <Text style={styles.emptySubtitle}>All co-sign requests have been resolved.</Text>
      </View>
    );
  }

  return (
    <View>
      {transactions.map((tx) => (
        <PendingTxCard
          key={tx.id}
          tx={tx}
          currentUserPublicKey={currentUserPublicKey}
          onSign={() => onSign(tx)}
          onReject={() => onReject(tx)}
        />
      ))}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  headerRight: { width: 60 },
  petBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    padding: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  petBannerEmoji: { fontSize: 20 },
  petBannerName: { fontSize: 16, fontWeight: '700', color: '#2e7d32', flex: 1 },
  multisigBadge: {
    backgroundColor: '#1565c0',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  multisigBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#4CAF50' },
  tabText: { fontSize: 14, color: '#666' },
  tabTextActive: { color: '#4CAF50', fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardSubtitle: { fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowLabel: { fontSize: 13, color: '#666' },
  rowValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    maxWidth: '55%',
    textAlign: 'right',
  },
  badge: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  coOwnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  coOwnerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  coOwnerInitial: { color: '#fff', fontWeight: '700', fontSize: 16 },
  coOwnerInfo: { flex: 1 },
  coOwnerName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  coOwnerEmail: { fontSize: 12, color: '#666', marginTop: 1 },
  coOwnerKey: { fontSize: 11, color: '#999', marginTop: 2, fontFamily: 'monospace' },
  coOwnerRight: { alignItems: 'flex-end', gap: 4 },
  weightLabel: { fontSize: 11, color: '#666', marginTop: 4 },
  inviteBtn: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  inviteBtnText: { color: '#4CAF50', fontWeight: '600', fontSize: 13 },
  criticalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#ffe0b2',
  },
  criticalBtnIcon: { fontSize: 22, marginRight: 12 },
  criticalBtnText: { flex: 1 },
  criticalBtnTitle: { fontSize: 14, fontWeight: '700', color: '#e65100' },
  criticalBtnSub: { fontSize: 12, color: '#bf360c', marginTop: 2 },
  chevron: { fontSize: 22, color: '#bbb' },
  txCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  txHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  txIcon: { fontSize: 24, marginRight: 10 },
  txHeaderText: { flex: 1 },
  txOpType: { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  txDescription: { fontSize: 12, color: '#666', marginTop: 2 },
  sigProgress: { marginBottom: 10 },
  sigProgressLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  sigBar: { height: 6, backgroundColor: '#e0e0e0', borderRadius: 3, overflow: 'hidden' },
  sigBarFill: { height: '100%', backgroundColor: '#4CAF50', borderRadius: 3 },
  signerList: { marginBottom: 8 },
  signerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  signerSigned: { fontSize: 12, color: '#4CAF50' },
  signerPending: { fontSize: 12, color: '#FF9800' },
  signerTime: { fontSize: 11, color: '#999' },
  expiryText: { fontSize: 11, color: '#999', marginBottom: 10 },
  expiryWarning: { color: '#F44336' },
  txActions: { flexDirection: 'row', gap: 10 },
  rejectBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#F44336',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rejectBtnText: { color: '#F44336', fontWeight: '600', fontSize: 14 },
  signBtn: {
    flex: 2,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  signBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
});

export default JointOwnershipScreen;
