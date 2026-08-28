/**
 * Trustline domain models
 * Issue #101 — Stellar Trustline Management UI
 */

export interface TrustlineAsset {
  /** Asset code, e.g. "PETC" */
  assetCode: string;
  /** Issuer public key */
  issuerPublicKey: string;
  /** Human-readable issuer label (optional) */
  issuerLabel?: string;
  /** Current balance held */
  balance: string;
  /** Trustline limit set by the user */
  limit: string;
  /** Amount locked by open sell offers on this asset (Horizon `selling_liabilities`) */
  sellingLiabilities: string;
  /** Amount locked by open buy offers on this asset (Horizon `buying_liabilities`) */
  buyingLiabilities: string;
  /** Whether this is a PetChain-issued asset */
  isPetChainAsset: boolean;
}

export interface TrustlineTransaction {
  id: string;
  type: 'add_trustline' | 'remove_trustline' | 'payment';
  assetCode: string;
  issuerPublicKey: string;
  amount?: string;
  txHash: string;
  ledger?: number;
  createdAt: string;
  successful: boolean;
}

export interface TrustlineState {
  accountPublicKey: string;
  /** XLM native balance */
  xlmBalance: string;
  /** XLM reserved per trustline (0.5 XLM each) */
  xlmReservePerTrustline: number;
  trustlines: TrustlineAsset[];
  /** Total XLM locked in reserves */
  totalReservedXlm: number;
  /** XLM available to spend */
  availableXlm: string;
}

export interface AddTrustlineParams {
  accountSecretKey: string;
  assetCode: string;
  issuerPublicKey: string;
  /** Optional custom limit; defaults to max */
  limit?: string;
}

export interface RemoveTrustlineParams {
  accountSecretKey: string;
  assetCode: string;
  issuerPublicKey: string;
}

/** PetChain-issued assets available to add */
export interface PetChainAssetDefinition {
  assetCode: string;
  issuerPublicKey: string;
  name: string;
  description: string;
  iconEmoji: string;
}
