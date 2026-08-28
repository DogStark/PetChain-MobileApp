import { useCallback, useState } from 'react';

import {
  verifyRecordIntegrity,
  type MedicalRecordWithChainData,
  type RecordIntegrityResult,
} from '../services/blockchainService';

export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'TAMPERED' | 'ERROR';

export interface UseBlockchainVerificationResult {
  verify: (record: MedicalRecordWithChainData) => Promise<RecordIntegrityResult | null>;
  status: VerificationStatus;
  isVerifying: boolean;
  error: Error | null;
}

const verificationCache = new Map<string, RecordIntegrityResult>();

const getStatusFromResult = (result: RecordIntegrityResult): VerificationStatus => {
  const providedHashMatches = result.providedHash ? result.localHashMatchesProvidedHash : true;

  return result.onChainVerified && providedHashMatches ? 'VERIFIED' : 'TAMPERED';
};

export function useBlockchainVerification(): UseBlockchainVerificationResult {
  const [status, setStatus] = useState<VerificationStatus>('UNVERIFIED');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const verify = useCallback(async (record: MedicalRecordWithChainData) => {
    if (!record?.id) {
      const invalidRecordError = new Error('Record ID is required');
      setStatus('ERROR');
      setError(invalidRecordError);
      return null;
    }

    const cachedResult = verificationCache.get(record.id);
    if (cachedResult) {
      setStatus(getStatusFromResult(cachedResult));
      setError(null);
      return cachedResult;
    }

    setIsVerifying(true);
    try {
      const result = await verifyRecordIntegrity(record);

      verificationCache.set(record.id, result);
      setStatus(getStatusFromResult(result));
      setError(null);
      return result;
    } catch (verificationError) {
      setStatus('ERROR');
      setError(
        verificationError instanceof Error
          ? verificationError
          : new Error('Failed to verify record integrity'),
      );
      return null;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  return { verify, status, isVerifying, error };
}

export default useBlockchainVerification;
