import { render } from '@testing-library/react-native';
import React from 'react';

// Mock screen component - adjust import based on actual structure
const SettingsScreen = () => (
  <div>
    <h1>Settings</h1>
    <div>Notification Preferences</div>
    <div>Privacy Settings</div>
    <div>Account Settings</div>
  </div>
);

describe('SettingsScreen Snapshots', () => {
  it('should match snapshot', () => {
    const { toJSON } = render(<SettingsScreen />);

    expect(toJSON()).toMatchSnapshot();
  });

  it('should render all sections', () => {
    const { getByText } = render(<SettingsScreen />);

    expect(getByText('Settings')).toBeTruthy();
    expect(getByText('Notification Preferences')).toBeTruthy();
    expect(getByText('Privacy Settings')).toBeTruthy();
    expect(getByText('Account Settings')).toBeTruthy();
  });
});
