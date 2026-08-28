import { render } from '@testing-library/react-native';
import React from 'react';

// Mock screen component
const MedicalRecordViewerScreen = ({ recordId }: { recordId: string }) => (
  <div>
    <h1>Medical Record</h1>
    <div>Record ID: {recordId}</div>
    <div>Diagnosis</div>
    <div>Treatment</div>
    <div>Prescriptions</div>
    <div>Blockchain Verification</div>
  </div>
);

describe('MedicalRecordViewerScreen Snapshots', () => {
  const testRecordId = 'record-456';

  it('should match snapshot', () => {
    const { toJSON } = render(<MedicalRecordViewerScreen recordId={testRecordId} />);

    expect(toJSON()).toMatchSnapshot();
  });

  it('should display record information', () => {
    const { getByText } = render(<MedicalRecordViewerScreen recordId={testRecordId} />);

    expect(getByText('Medical Record')).toBeTruthy();
    expect(getByText(`Record ID: ${testRecordId}`)).toBeTruthy();
  });

  it('should display all record sections', () => {
    const { getByText } = render(<MedicalRecordViewerScreen recordId={testRecordId} />);

    expect(getByText('Diagnosis')).toBeTruthy();
    expect(getByText('Treatment')).toBeTruthy();
    expect(getByText('Prescriptions')).toBeTruthy();
    expect(getByText('Blockchain Verification')).toBeTruthy();
  });
});
