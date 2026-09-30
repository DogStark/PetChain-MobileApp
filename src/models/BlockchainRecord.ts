export enum VerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
}

/**
 * Stellar blockchain transaction record linked to a PetChain record.
 */
export interface BlockchainRecord {
  txHash: string;
  recordId: string;
  timestamp: string;
  networkId: string;
  verified: boolean;
}

/**
 * Result returned after checking a Stellar transaction verification state.
 */
export type VerificationResult = {
  status: VerificationStatus;
  verifiedAt: string;
  txHash: string;
};
