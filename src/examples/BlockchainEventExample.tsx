/**
 * Example React Native component demonstrating blockchain event integration
 * This shows how to use the real-time blockchain event services in a React Native app
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';

import blockchainIntegration, {
  type RecordVerificationStatus,
  type IntegrationStatus,
} from '../services/blockchainIntegration';
import { loggerService } from '../services/loggerService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventLog {
  id: string;
  type: 'transaction' | 'verification' | 'connection' | 'error';
  message: string;
  timestamp: string;
  data?: any;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const BlockchainEventExample: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>({
    connected: false,
    activeAccounts: [],
    pendingVerifications: 0,
    lastEventTime: null,
    error: null,
  });
  const [verificationStatuses, setVerificationStatuses] = useState<RecordVerificationStatus[]>([]);
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sample PetChain accounts for demonstration
  const SAMPLE_ACCOUNTS = [
    'GACCOUNT1EXAMPLE1234567890ABCDEF1234567890ABCDEF12',
    'GACCOUNT2EXAMPLE1234567890ABCDEF1234567890ABCDEF12',
  ];

  // ─── Event Handlers ───────────────────────────────────────────────────────────

  const addEventLog = useCallback((type: EventLog['type'], message: string, data?: any) => {
    const newLog: EventLog = {
      id: Date.now().toString(),
      type,
      message,
      timestamp: new Date().toISOString(),
      data,
    };

    setEventLogs((prev) => [newLog, ...prev.slice(0, 49)]); // Keep last 50 events
  }, []);

  const handleTransactionEvent = useCallback(
    (transaction: any) => {
      addEventLog(
        'transaction',
        `Transaction ${transaction.transactionHash.slice(0, 8)}... ${
          transaction.successful ? 'succeeded' : 'failed'
        }`,
        transaction,
      );

      // Update verification statuses
      setVerificationStatuses(blockchainIntegration.getAllVerificationStatuses());
    },
    [addEventLog],
  );

  const handleVerificationUpdate = useCallback(
    (update: any) => {
      addEventLog(
        'verification',
        `Record ${update.recordId} ${update.verified ? 'verified' : 'verification failed'}`,
        update,
      );

      // Update verification statuses
      setVerificationStatuses(blockchainIntegration.getAllVerificationStatuses());
    },
    [addEventLog],
  );

  const handleConnectionStatus = useCallback(
    (status: any) => {
      addEventLog(
        'connection',
        `Connection ${status.connected ? 'established' : 'lost'}${
          status.error ? `: ${status.error}` : ''
        }`,
        status,
      );

      // Update integration status
      setIntegrationStatus(blockchainIntegration.getStatus());
    },
    [addEventLog],
  );

  const handleError = useCallback(
    (error: any) => {
      addEventLog('error', `Error: ${error.message || 'Unknown error'}`, error);
    },
    [addEventLog],
  );

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const initializeIntegration = async () => {
      try {
        loggerService.info('Initializing blockchain integration example');

        // Set up event listeners
        blockchainIntegration.on('transactionProcessed', handleTransactionEvent);
        blockchainIntegration.on('verificationUpdated', handleVerificationUpdate);
        blockchainIntegration.on('connectionStatus', handleConnectionStatus);
        blockchainIntegration.on('error', handleError);

        // Initialize the integration service
        await blockchainIntegration.initialize(SAMPLE_ACCOUNTS);

        // Update initial state
        setIntegrationStatus(blockchainIntegration.getStatus());
        setVerificationStatuses(blockchainIntegration.getAllVerificationStatuses());
        setIsInitialized(true);

        addEventLog('connection', 'Blockchain integration initialized');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Initialization failed';
        addEventLog('error', `Initialization failed: ${errorMessage}`);
        Alert.alert('Initialization Error', errorMessage);
      }
    };

    initializeIntegration();

    // Cleanup on unmount
    return () => {
      blockchainIntegration.removeAllListeners();
      blockchainIntegration.disconnect();
    };
  }, [
    handleTransactionEvent,
    handleVerificationUpdate,
    handleConnectionStatus,
    handleError,
    addEventLog,
  ]);

  // ─── Actions ──────────────────────────────────────────────────────────────────

  const addSampleRecord = useCallback(async () => {
    try {
      const recordId = `record_${Date.now()}`;
      const sampleHash = `hash_${Math.random().toString(36).substring(7)}`;

      await blockchainIntegration.addRecordForVerification(recordId, sampleHash);

      setVerificationStatuses(blockchainIntegration.getAllVerificationStatuses());
      addEventLog('verification', `Added record ${recordId} for verification`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add record';
      addEventLog('error', errorMessage);
      Alert.alert('Error', errorMessage);
    }
  }, [addEventLog]);

  const checkRecordVerification = useCallback(
    async (recordId: string) => {
      try {
        const sampleHash = `hash_${Math.random().toString(36).substring(7)}`;
        const verified = await blockchainIntegration.checkRecordVerification(recordId, sampleHash);

        setVerificationStatuses(blockchainIntegration.getAllVerificationStatuses());
        addEventLog(
          'verification',
          `Manual verification check for ${recordId}: ${verified ? 'verified' : 'not verified'}`,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Verification check failed';
        addEventLog('error', errorMessage);
        Alert.alert('Error', errorMessage);
      }
    },
    [addEventLog],
  );

  const clearData = useCallback(async () => {
    try {
      await blockchainIntegration.clearVerificationData();
      setVerificationStatuses([]);
      addEventLog('verification', 'Cleared all verification data');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to clear data';
      addEventLog('error', errorMessage);
      Alert.alert('Error', errorMessage);
    }
  }, [addEventLog]);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setIntegrationStatus(blockchainIntegration.getStatus());
      setVerificationStatuses(blockchainIntegration.getAllVerificationStatuses());
      addEventLog('connection', 'Data refreshed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Refresh failed';
      addEventLog('error', errorMessage);
    } finally {
      setIsRefreshing(false);
    }
  }, [addEventLog]);

  // ─── Render Helpers ───────────────────────────────────────────────────────────

  const renderConnectionStatus = () => (
    <View style={styles.statusCard}>
      <Text style={styles.cardTitle}>Connection Status</Text>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Connected:</Text>
        <Text
          style={[
            styles.statusValue,
            { color: integrationStatus.connected ? '#4CAF50' : '#F44336' },
          ]}
        >
          {integrationStatus.connected ? 'Yes' : 'No'}
        </Text>
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Active Accounts:</Text>
        <Text style={styles.statusValue}>{integrationStatus.activeAccounts.length}</Text>
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Pending Verifications:</Text>
        <Text style={styles.statusValue}>{integrationStatus.pendingVerifications}</Text>
      </View>
      {integrationStatus.error && (
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Error:</Text>
          <Text style={[styles.statusValue, { color: '#F44336' }]}>{integrationStatus.error}</Text>
        </View>
      )}
    </View>
  );

  const renderVerificationStatuses = () => (
    <View style={styles.statusCard}>
      <Text style={styles.cardTitle}>Verification Statuses ({verificationStatuses.length})</Text>
      {verificationStatuses.length === 0 ? (
        <Text style={styles.emptyText}>No records being monitored</Text>
      ) : (
        verificationStatuses.map((status) => (
          <View key={status.recordId} style={styles.recordItem}>
            <View style={styles.recordHeader}>
              <Text style={styles.recordId}>{status.recordId}</Text>
              <Text
                style={[
                  styles.verificationBadge,
                  { backgroundColor: status.verified ? '#4CAF50' : '#FF9800' },
                ]}
              >
                {status.verified ? 'Verified' : 'Pending'}
              </Text>
            </View>
            <Text style={styles.recordDetail}>
              Last checked: {new Date(status.lastChecked).toLocaleTimeString()}
            </Text>
            {status.transactionHash && (
              <Text style={styles.recordDetail}>TX: {status.transactionHash.slice(0, 16)}...</Text>
            )}
            <TouchableOpacity
              style={styles.checkButton}
              onPress={() => checkRecordVerification(status.recordId)}
            >
              <Text style={styles.checkButtonText}>Check Now</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );

  const renderEventLogs = () => (
    <View style={styles.statusCard}>
      <Text style={styles.cardTitle}>Event Log ({eventLogs.length})</Text>
      {eventLogs.length === 0 ? (
        <Text style={styles.emptyText}>No events yet</Text>
      ) : (
        eventLogs.slice(0, 10).map((log) => (
          <View key={log.id} style={styles.logItem}>
            <View style={styles.logHeader}>
              <Text style={[styles.logType, { color: getLogTypeColor(log.type) }]}>
                {log.type.toUpperCase()}
              </Text>
              <Text style={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
            </View>
            <Text style={styles.logMessage}>{log.message}</Text>
          </View>
        ))
      )}
    </View>
  );

  const getLogTypeColor = (type: EventLog['type']) => {
    switch (type) {
      case 'transaction':
        return '#2196F3';
      case 'verification':
        return '#4CAF50';
      case 'connection':
        return '#FF9800';
      case 'error':
        return '#F44336';
      default:
        return '#757575';
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (!isInitialized) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Initializing blockchain integration...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshData} />}
    >
      <Text style={styles.title}>Blockchain Event Integration</Text>

      {renderConnectionStatus()}

      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={addSampleRecord}>
          <Text style={styles.actionButtonText}>Add Sample Record</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionButton, styles.dangerButton]} onPress={clearData}>
          <Text style={styles.actionButtonText}>Clear Data</Text>
        </TouchableOpacity>
      </View>

      {renderVerificationStatuses()}
      {renderEventLogs()}
    </ScrollView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 50,
    color: '#666',
  },
  statusCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 20,
  },
  recordItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 12,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  recordId: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    flex: 1,
  },
  verificationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  recordDetail: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  checkButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  checkButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  actionButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
    flex: 0.48,
  },
  dangerButton: {
    backgroundColor: '#F44336',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  logItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 8,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  logType: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  logTime: {
    fontSize: 12,
    color: '#666',
  },
  logMessage: {
    fontSize: 14,
    color: '#333',
  },
});

export default BlockchainEventExample;
