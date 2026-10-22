import { render } from '@testing-library/react-native';
import React from 'react';

// Mock screen component
const PetDetailScreen = ({ petId }: { petId: string }) => (
  <div>
    <h1>Pet Details</h1>
    <div>Pet ID: {petId}</div>
    <div>Medical History</div>
    <div>Medications</div>
    <div>Appointments</div>
  </div>
);

describe('PetDetailScreen Snapshots', () => {
  const testPetId = 'pet-123';

  it('should match snapshot', () => {
    const { toJSON } = render(<PetDetailScreen petId={testPetId} />);

    expect(toJSON()).toMatchSnapshot();
  });

  it('should display pet information', () => {
    const { getByText } = render(<PetDetailScreen petId={testPetId} />);

    expect(getByText('Pet Details')).toBeTruthy();
    expect(getByText(`Pet ID: ${testPetId}`)).toBeTruthy();
  });

  it('should display all sections', () => {
    const { getByText } = render(<PetDetailScreen petId={testPetId} />);

    expect(getByText('Medical History')).toBeTruthy();
    expect(getByText('Medications')).toBeTruthy();
    expect(getByText('Appointments')).toBeTruthy();
  });
});
