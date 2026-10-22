/**
 * PetNFTScreen — displays a pet's NFT metadata from Stellar + IPFS.
 *
 * Data flow:
 *   1. Fetch asset issuer's stellar.toml from home_domain
 *   2. Extract IPFS hash from the NFT_METADATA_IPFS_HASH field
 *   3. Fetch JSON from IPFS gateway
 *   4. Validate against Zod schema
 *   5. Render metadata, or skeleton / error / empty states
 */
import axios from 'axios';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { z } from 'zod';

// ─── Zod schema ───────────────────────────────────────────────────────────────

const AttributeSchema = z.object({
  trait_type: z.string(),
  value: z.union([z.string(), z.number()]),
});

const NFTMetadataSchema = z.object({
  name: z.string().min(1),
  image: z.string().url(),
  mint_date: z.string().optional(),
  attributes: z.array(AttributeSchema).optional().default([]),
});

export type NFTMetadata = z.infer<typeof NFTMetadataSchema>;

// ─── Constants ────────────────────────────────────────────────────────────────

const IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs/';
const STELLAR_EXPERT_TX = 'https://stellar.expert/explorer/testnet/tx/';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Stellar asset code, e.g. "PETNFT001" */
  assetCode: string;
  /** Issuer public key */
  issuerPublicKey: string;
  /** home_domain value from the Stellar account — used to locate stellar.toml */
  homeDomain: string;
  /** Transaction ID of the mint tx (optional — shown as a deep link) */
  mintTxId?: string;
  onBack?: () => void;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchTomlIpfsHash(homeDomain: string, assetCode: string): Promise<string> {
  const url = `https://${homeDomain}/.well-known/stellar.toml`;
  const { data: text } = await axios.get<string>(url, { responseType: 'text', timeout: 10_000 });

  // Find NFT_METADATA_IPFS_HASH or asset-specific line: PETNAME_NFT_IPFS_HASH
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]+)"/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (
      key === 'NFT_METADATA_IPFS_HASH' ||
      key === `${assetCode}_IPFS_HASH` ||
      key === 'IPFS_HASH'
    ) {
      return val;
    }
  }
  throw new Error('NFT IPFS hash not found in stellar.toml');
}

async function fetchIpfsMetadata(ipfsHash: string): Promise<NFTMetadata> {
  const url = `${IPFS_GATEWAY}${ipfsHash}`;
  const { data } = await axios.get<unknown>(url, { timeout: 15_000 });
  const result = NFTMetadataSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid NFT metadata: ${result.error.issues.map((i) => i.message).join(', ')}`,
    );
  }
  return result.data;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonBox({
  width,
  height,
  style,
}: {
  width: number | string;
  height: number;
  style?: object;
}) {
  return <View style={[styles.skeleton, { width: width as number, height }, style]} />;
}

function SkeletonLoader() {
  return (
    <View style={styles.content}>
      <SkeletonBox width="100%" height={220} style={styles.skeletonImage} />
      <SkeletonBox width="60%" height={22} style={styles.skeletonLine} />
      <SkeletonBox width="40%" height={16} style={styles.skeletonLine} />
      <SkeletonBox width="100%" height={80} style={styles.skeletonLine} />
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.stateIcon}>⚠️</Text>
      <Text style={styles.stateTitle}>Failed to Load NFT</Text>
      <Text style={styles.stateBody}>{message}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
        <Text style={styles.retryBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.stateIcon}>🐾</Text>
      <Text style={styles.stateTitle}>No NFT Minted</Text>
      <Text style={styles.stateBody}>This pet doesn't have an NFT on the Stellar network yet.</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export const PetNFTScreen: React.FC<Props> = ({
  assetCode,
  issuerPublicKey,
  homeDomain,
  mintTxId,
  onBack,
}) => {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [metadata, setMetadata] = useState<NFTMetadata | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      const ipfsHash = await fetchTomlIpfsHash(homeDomain, assetCode);
      const data = await fetchIpfsMetadata(ipfsHash);
      setMetadata(data);
      setLoadState('loaded');
    } catch (err: any) {
      const msg: string = err?.message ?? 'Unknown error';
      // "not found" variants → empty state
      if (
        msg.includes('not found in stellar.toml') ||
        msg.includes('404') ||
        msg.includes('No NFT')
      ) {
        setLoadState('empty');
      } else {
        setErrorMsg(msg);
        setLoadState('error');
      }
    }
  }, [homeDomain, assetCode]);

  useEffect(() => {
    load();
  }, [load]);

  const openTx = () => {
    if (mintTxId) {
      void Linking.openURL(`${STELLAR_EXPERT_TX}${mintTxId}`);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Pet NFT</Text>
        <View style={styles.headerRight} />
      </View>

      {loadState === 'loading' && <SkeletonLoader />}
      {loadState === 'error' && <ErrorState message={errorMsg} onRetry={load} />}
      {loadState === 'empty' && <EmptyState />}

      {loadState === 'loaded' && metadata && (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Pet image */}
          <Image
            source={{ uri: metadata.image }}
            style={styles.nftImage}
            resizeMode="cover"
            accessibilityLabel={`NFT image for ${metadata.name}`}
          />

          {/* Name & mint date */}
          <Text style={styles.nftName}>{metadata.name}</Text>
          {metadata.mint_date && <Text style={styles.mintDate}>Minted {metadata.mint_date}</Text>}

          {/* Asset info */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Asset</Text>
            <Text style={styles.mono}>{assetCode}</Text>
            <Text style={styles.monoSmall} numberOfLines={1}>
              {issuerPublicKey}
            </Text>
          </View>

          {/* Attributes */}
          {metadata.attributes.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Attributes</Text>
              <View style={styles.attrsGrid}>
                {metadata.attributes.map((attr, i) => (
                  <View key={i} style={styles.attrChip}>
                    <Text style={styles.attrType}>{attr.trait_type}</Text>
                    <Text style={styles.attrValue}>{String(attr.value)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Transaction deep link */}
          {mintTxId && (
            <TouchableOpacity style={styles.txRow} onPress={openTx} accessibilityRole="link">
              <Text style={styles.txLabel}>Mint Transaction</Text>
              <Text style={styles.txId} numberOfLines={1}>
                {mintTxId.slice(0, 16)}…{mintTxId.slice(-8)}
              </Text>
              <Text style={styles.txArrow}>↗</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
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
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  headerRight: { width: 48 },
  content: { padding: 16, paddingBottom: 40 },
  // Skeleton
  skeleton: { backgroundColor: '#e0e0e0', borderRadius: 8 },
  skeletonImage: { borderRadius: 12, marginBottom: 14 },
  skeletonLine: { marginBottom: 10 },
  // Centered states
  centeredState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  stateIcon: { fontSize: 48, marginBottom: 12 },
  stateTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  stateBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    marginTop: 20,
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  // NFT display
  nftImage: { width: '100%', height: 220, borderRadius: 12, marginBottom: 14 },
  nftName: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  mintDate: { fontSize: 13, color: '#888', marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    color: '#1a1a1a',
  },
  monoSmall: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: '#888',
    marginTop: 4,
  },
  attrsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attrChip: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#c8e6c9',
    minWidth: 80,
  },
  attrType: { fontSize: 10, fontWeight: '700', color: '#2e7d32', textTransform: 'uppercase' },
  attrValue: { fontSize: 13, color: '#1a1a1a', marginTop: 2 },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  txLabel: { fontSize: 13, fontWeight: '600', color: '#444' },
  txId: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: '#1565c0',
  },
  txArrow: { fontSize: 16, color: '#1565c0' },
});

export default PetNFTScreen;
