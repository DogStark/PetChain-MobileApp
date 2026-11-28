/**
 * SyncRetryDetailScreen tests — Issue #1178
 *
 * Covers the main retry flow, server-confirmed denial, stale records, offline
 * behaviour, the exhausted retry count boundary, and the privacy guarantee that
 * queued payload values never appear on screen.
 */

jest.mock('../../services/syncEngine', () => ({
  __esModule: true,
  default: {
    listRetryRecords: jest.fn(),
    getRetryLimit: jest.fn(() => 5),
    retryRecord: jest.fn(),
  },
}));

jest.mock('../../utils/networkMonitor', () => ({
  networkMonitor: {
    isOnline: jest.fn(() => Promise.resolve(true)),
  },
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import SyncRetryDetailScreen from '../SyncRetryDetailScreen';
import syncEngine from '../../services/syncEngine';
import { networkMonitor } from '../../utils/networkMonitor';

const engine = syncEngine as unknown as {
  listRetryRecords: jest.Mock;
  getRetryLimit: jest.Mock;
  retryRecord: jest.Mock;
};
const monitor = networkMonitor as unknown as { isOnline: jest.Mock };

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'pet:pet_1234567890',
  entityType: 'pet',
  entityId: 'pet_1234567890',
  action: 'update',
  updatedAt: '2026-10-22T06:00:00.000Z',
  syncVersion: 2,
  attempts: 2,
  lastError: 'Request failed with status code 503',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  engine.getRetryLimit.mockReturnValue(5);
  engine.listRetryRecords.mockResolvedValue([makeRecord()]);
  monitor.isOnline.mockResolvedValue(true);
});

describe('SyncRetryDetailScreen', () => {
  it('shows the last error, affected record and retry count, then retries safely', async () => {
    // The payload is present on the raw queue row but must never be rendered.
    engine.listRetryRecords.mockResolvedValue([
      makeRecord({ payload: { name: 'Milo', notes: 'private medical content' } }),
    ]);

    const { findByText, getByTestId, getByText, queryByText } = render(
      <SyncRetryDetailScreen onBack={jest.fn()} />,
    );

    expect(await findByText('Request failed with status code 503')).toBeTruthy();
    expect(getByText('pet_12…7890')).toBeTruthy();
    expect(getByText('2 of 5')).toBeTruthy();
    expect(getByText(/Only sync details are shown here/)).toBeTruthy();
    expect(queryByText('Milo')).toBeNull();
    expect(queryByText('private medical content')).toBeNull();

    engine.retryRecord.mockResolvedValue({ type: 'completed' });
    engine.listRetryRecords.mockResolvedValueOnce([]);

    fireEvent.press(getByTestId('sync-retry-button-pet:pet_1234567890'));

    await waitFor(() =>
      expect(engine.retryRecord).toHaveBeenCalledWith('pet:pet_1234567890', {
        attempts: 2,
        syncVersion: 2,
      }),
    );
    expect(await findByText('Nothing is waiting to sync')).toBeTruthy();
  });

  it('stops offering retry after the server confirms permission denial', async () => {
    engine.retryRecord.mockResolvedValue({
      type: 'permission-denied',
      current: makeRecord(),
      message: 'Request failed with status code 403',
    });

    const { findByText, getByTestId } = render(
      <SyncRetryDetailScreen onBack={jest.fn()} />,
    );

    await findByText('Request failed with status code 503');
    fireEvent.press(getByTestId('sync-retry-button-pet:pet_1234567890'));

    expect(await findByText(/server denied permission to retry synced changes/i)).toBeTruthy();
    expect(getByTestId('sync-retry-button-pet:pet_1234567890').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('refreshes and explains when the retry snapshot is stale', async () => {
    engine.retryRecord.mockResolvedValue({ type: 'stale', current: null });

    const { findByText, getByTestId } = render(
      <SyncRetryDetailScreen recordId="pet:pet_1234567890" onBack={jest.fn()} />,
    );

    await findByText('Request failed with status code 503');
    engine.listRetryRecords.mockResolvedValueOnce([]);
    fireEvent.press(getByTestId('sync-retry-button-pet:pet_1234567890'));

    expect(await findByText(/was updated elsewhere since you opened this screen/i)).toBeTruthy();
    expect(await findByText('Nothing is waiting to sync')).toBeTruthy();
    expect(await findByText(/already synced or is no longer queued/i)).toBeTruthy();
  });

  it('keeps retry disabled while offline', async () => {
    monitor.isOnline.mockResolvedValue(false);

    const { findByText, getByTestId } = render(
      <SyncRetryDetailScreen onBack={jest.fn()} />,
    );

    expect(await findByText(/You're offline\. Retry is unavailable/)).toBeTruthy();
    const button = getByTestId('sync-retry-button-pet:pet_1234567890');
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(engine.retryRecord).not.toHaveBeenCalled();
  });

  it('allows an explicit retry when the automatic retry limit is exhausted', async () => {
    engine.listRetryRecords.mockResolvedValue([makeRecord({ attempts: 5 })]);

    const { findByText, getByTestId } = render(
      <SyncRetryDetailScreen onBack={jest.fn()} />,
    );

    expect(await findByText('5 of 5 · automatic retries paused')).toBeTruthy();
    expect(getByTestId('sync-retry-button-pet:pet_1234567890').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('shows a focused stale state when the requested record is gone', async () => {
    engine.listRetryRecords.mockResolvedValue([]);

    const { findByText } = render(
      <SyncRetryDetailScreen recordId="pet:missing" onBack={jest.fn()} />,
    );

    expect(await findByText('Nothing is waiting to sync')).toBeTruthy();
    expect(await findByText(/already synced or is no longer queued/i)).toBeTruthy();
  });

  it('shows a safe error and a reload action when local details cannot be read', async () => {
    engine.listRetryRecords.mockRejectedValue(new Error('database unavailable'));

    const { findByText, getByText } = render(
      <SyncRetryDetailScreen onBack={jest.fn()} />,
    );

    expect(await findByText('Sync details could not be read from this device.')).toBeTruthy();
    expect(getByText('Try again')).toBeTruthy();
  });
});
