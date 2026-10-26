import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import EmergencyDirectoryScreen from '../src/screens/EmergencyDirectoryScreen';
import { emergencyDirectoryService } from '../src/services/emergencyDirectoryService';

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn(() => Promise.resolve()),
  canOpenURL: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../src/services/emergencyDirectoryService', () => ({
  emergencyDirectoryService: {
    fetchDirectory: jest.fn(),
  },
}));

const mockedService = emergencyDirectoryService as jest.Mocked<
  typeof emergencyDirectoryService
>;

const openURL = Linking.openURL as jest.Mock;

const freshDirectory = {
  fetchedAt: new Date().toISOString(),
  stale: false,
  clinics: [
    {
      id: 'clinic-1',
      name: 'Downtown Animal ER',
      phone: '+15550100',
      address: '1 Main St',
      isOpenNow: true,
      hours: 'Open 24 hours',
    },
    {
      id: 'clinic-2',
      name: 'Uptown Vet',
      phone: '+15550101',
      address: '2 High St',
      isOpenNow: false,
      hours: 'Mon-Fri 9:00-17:00',
    },
  ],
};

describe('EmergencyDirectoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders clinic hours and open status for the main flow', async () => {
    mockedService.fetchDirectory.mockResolvedValue(freshDirectory);

    const { getByText, findByText } = render(<EmergencyDirectoryScreen />);

    expect(await findByText('Downtown Animal ER')).toBeTruthy();
    expect(getByText('Open 24 hours')).toBeTruthy();
    expect(getByText('Mon-Fri 9:00-17:00')).toBeTruthy();
    expect(getByText('Open now')).toBeTruthy();
    expect(getByText('Closed')).toBeTruthy();
  });

  it('shows source freshness for the directory data', async () => {
    mockedService.fetchDirectory.mockResolvedValue(freshDirectory);

    const { findByText } = render(<EmergencyDirectoryScreen />);

    expect(await findByText(/Updated/)).toBeTruthy();
  });

  it('opens the dialer when a clinic contact action is pressed', async () => {
    mockedService.fetchDirectory.mockResolvedValue(freshDirectory);

    const { findAllByText } = render(<EmergencyDirectoryScreen />);

    const callButtons = await findAllByText('Call');
    fireEvent.press(callButtons[0]);

    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith('tel:+15550100');
    });
  });

  it('surfaces stale data with a retry action', async () => {
    mockedService.fetchDirectory.mockResolvedValue({
      ...freshDirectory,
      stale: true,
    });

    const { findByText, getByText } = render(<EmergencyDirectoryScreen />);

    expect(await findByText(/may be out of date/i)).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('shows an explicit emergency services path when data is unavailable', async () => {
    mockedService.fetchDirectory.mockRejectedValue(new Error('offline'));

    const { findByText, getByText } = render(<EmergencyDirectoryScreen />);

    expect(await findByText(/directory is unavailable/i)).toBeTruthy();

    fireEvent.press(getByText('Call emergency services'));

    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith('tel:911');
    });
  });

  it('exposes an accessible summary and data table for screen readers', async () => {
    mockedService.fetchDirectory.mockResolvedValue(freshDirectory);

    const { findByLabelText, getByLabelText } = render(<EmergencyDirectoryScreen />);

    expect(await findByLabelText(/clinic summary/i)).toBeTruthy();
    expect(getByLabelText(/Downtown Animal ER.*open now/i)).toBeTruthy();
    expect(getByLabelText(/Uptown Vet.*closed/i)).toBeTruthy();
  });

  it('does not rely on color alone for open status', async () => {
    mockedService.fetchDirectory.mockResolvedValue(freshDirectory);

    const { findByText } = render(<EmergencyDirectoryScreen />);

    expect(await findByText('Open now')).toBeTruthy();
    expect(await findByText('Closed')).toBeTruthy();
  });

  it('retries the directory fetch after a failure', async () => {
    mockedService.fetchDirectory
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(freshDirectory);

    const { findByText, getByText } = render(<EmergencyDirectoryScreen />);

    expect(await findByText(/directory is unavailable/i)).toBeTruthy();

    fireEvent.press(getByText('Retry'));

    expect(await findByText('Downtown Animal ER')).toBeTruthy();
    expect(mockedService.fetchDirectory).toHaveBeenCalledTimes(2);
  });
});
