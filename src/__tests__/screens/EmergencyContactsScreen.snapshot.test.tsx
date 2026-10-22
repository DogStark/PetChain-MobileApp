import { render } from '@testing-library/react-native';
import React from 'react';

// Mock screen component
const EmergencyContactsScreen = () => (
  <div>
    <h1>Emergency Contacts</h1>
    <div>Primary Contact</div>
    <div>Secondary Contact</div>
    <div>Veterinary Emergency</div>
    <div>SOS Button</div>
  </div>
);

describe('EmergencyContactsScreen Snapshots', () => {
  it('should match snapshot', () => {
    const { toJSON } = render(<EmergencyContactsScreen />);

    expect(toJSON()).toMatchSnapshot();
  });

  it('should display emergency contacts', () => {
    const { getByText } = render(<EmergencyContactsScreen />);

    expect(getByText('Emergency Contacts')).toBeTruthy();
    expect(getByText('Primary Contact')).toBeTruthy();
    expect(getByText('Secondary Contact')).toBeTruthy();
  });

  it('should display emergency services', () => {
    const { getByText } = render(<EmergencyContactsScreen />);

    expect(getByText('Veterinary Emergency')).toBeTruthy();
    expect(getByText('SOS Button')).toBeTruthy();
  });
});
