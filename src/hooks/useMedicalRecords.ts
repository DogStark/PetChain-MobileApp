import { useCallback, useEffect, useState } from 'react';

import {
  getMedicalRecords,
  type MedicalRecord,
  type RecordFilters,
} from '../services/medicalRecordService';

type MedicalRecordType = NonNullable<RecordFilters['type']>;

export interface UseMedicalRecordsResult {
  records: MedicalRecord[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  filterByType: (type?: MedicalRecordType) => void;
}

const recordsCache = new Map<string, MedicalRecord[]>();

export function useMedicalRecords(petId: string): UseMedicalRecordsResult {
  const [records, setRecords] = useState<MedicalRecord[]>(
    () => recordsCache.get(`${petId}:all`) ?? [],
  );
  const [recordType, setRecordType] = useState<MedicalRecordType | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchRecords = useCallback(async () => {
    if (!petId) {
      setRecords([]);
      setError(null);
      return;
    }

    const cacheKey = `${petId}:${recordType ?? 'all'}`;
    const cachedRecords = recordsCache.get(cacheKey);

    if (cachedRecords) {
      setRecords(cachedRecords);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const response = await getMedicalRecords(
        petId,
        recordType ? { type: recordType } : undefined,
      );
      const fetchedRecords = response.data.data;

      recordsCache.set(cacheKey, fetchedRecords);
      setRecords(fetchedRecords);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError : new Error('Failed to fetch records'));
    } finally {
      setIsLoading(false);
    }
  }, [petId, recordType]);

  const refetch = useCallback(async () => {
    if (petId) {
      recordsCache.delete(`${petId}:${recordType ?? 'all'}`);
    }
    await fetchRecords();
  }, [fetchRecords, petId, recordType]);

  const filterByType = useCallback((type?: MedicalRecordType) => {
    setRecordType(type);
  }, []);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  return { records, isLoading, error, refetch, filterByType };
}

export default useMedicalRecords;
