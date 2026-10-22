import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AdoptionScreen from '../AdoptionScreen';
import * as adoptionService from '../../services/adoptionService';
import { useAuth } from '../../hooks/useAuth';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

jest.mock('../../services/adoptionService');
jest.mock('../../hooks/useAuth');
jest.mock('../../hooks/useNetworkStatus');

const mockedService = adoptionService as jest.Mocked<typeof adoptionService>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseNetworkStatus = useNetworkStatus as jest.MockedFunction<
  typeof useNetworkStatus
>;

const baseApplication = {
  id: 'app-1',
  petId: 'pet-1',
  petName: 'Biscuit',
  applicantId: 'user-1',
  status: 'in_review' as const,
  submittedAt: '2024-05-01T10:00:00.000Z',
  steps: [
    {
      id: 'step-1',
      title: 'Submit application',
      status: 'complete' as const,
      dueDate: '2024-05-02T10:00:00.000Z',
      documents: [],
    },
    {
      id: 'step-2',
      title: 'Home visit',
      status: 'in_progress' as const,
      dueDate: '2024-05-10T10:00:00.000Z',
      documents: [
        {
          id: 'doc-1',
          name: 'Proof of residence',
          status: 'requested' as const,
          dueDate: '2024-05-08T10:00:00.000Z',
        },
      ],
    },
    {
      id: 'step-3',
      title: 'Final approval',
      status: 'pending' as const,
      dueDate: '2024-05-20T10:00:00.000Z',
      documents: [
        {
          id: 'doc-2',
          name: 'Vet reference',
          status: 'approved' as const,
          dueDate: null,
        },
      ],
    },
  ],
};

function setupAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockedUseAuth.mockReturnValue({
    user: { id: 'user-1', name: 'Jane' },
    isAuthenticated: true,
    permissions: ['adoption:read'],
    ...overrides,
  } as ReturnType<typeof useAuth>);
}

function setupNetwork(online = true) {
  mockedUseNetworkStatus.mockReturnValue({
    isConnected: online,
    isInternetReachable: online,
  } as ReturnType<typeof useNetworkStatus>);
}

describe('AdoptionScreen progress details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAuth();
    setupNetwork(true);
  });

  it('renders steps, documents, review status and due dates for the main flow', async () => {
    mockedService.getApplicationProgress.mockResolvedValue(baseApplication);

    const { getByText, getByTestId, getAllByTestId } = render(
      <AdoptionScreen applicationId="app-1" />,
    );

    await waitFor(() => {
      expect(mockedService.getApplicationProgress).toHaveBeenCalledWith('app-1');
    });

    expect(getByText('Submit application')).toBeTruthy();
    expect(getByText('Home visit')).toBeTruthy();
    expect(getByText('Final approval')).toBeTruthy();

    expect(getByText('Proof of residence')).toBeTruthy();
    expect(getByText('Vet reference')).toBeTruthy();

    expect(getByTestId('step-status-step-1')).toHaveTextContent('Complete');
    expect(getByTestId('step-status-step-2')).toHaveTextContent('In progress');
    expect(getByTestId('step-status-step-3')).toHaveTextContent('Pending');

    expect(getByTestId('step-due-step-2')).toBeTruthy();
    expect(getByTestId('document-due-doc-1')).toBeTruthy();

    expect(getAllByTestId(/^step-item-/)).toHaveLength(3);
  });

  it('shows a permission denial state and does not fetch when permission is missing', async () => {
    setupAuth({ permissions: [] });

    const { getByText, queryByText } = render(
      <AdoptionScreen applicationId="app-1" />,
    );

    await waitFor(() => {
      expect(getByText(/don't have permission/i)).toBeTruthy();
    });

    expect(mockedService.getApplicationProgress).not.toHaveBeenCalled();
    expect(queryByText('Home visit')).toBeNull();
  });

  it('shows a stale-data warning when the server reports stale data', async () => {
    mockedService.getApplicationProgress.mockResolvedValue({
      ...baseApplication,
      stale: true,
    });

    const { getByText } = render(<AdoptionScreen applicationId="app-1" />);

    await waitFor(() => {
      expect(getByText(/may be out of date/i)).toBeTruthy();
    });
  });

  it('retries after a failed fetch and renders data on success', async () => {
    mockedService.getApplicationProgress
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(baseApplication);

    const { getByText, getByTestId } = render(
      <AdoptionScreen applicationId="app-1" />,
    );

    await waitFor(() => {
      expect(getByText(/could not load/i)).toBeTruthy();
    });

    fireEvent.press(getByTestId('retry-button'));

    await waitFor(() => {
      expect(getByText('Home visit')).toBeTruthy();
    });

    expect(mockedService.getApplicationProgress).toHaveBeenCalledTimes(2);
  });

  it('renders an empty state when there are no steps', async () => {
    mockedService.getApplicationProgress.mockResolvedValue({
      ...baseApplication,
      steps: [],
    });

    const { getByText } = render(<AdoptionScreen applicationId="app-1" />);

    await waitFor(() => {
      expect(getByText(/no progress steps/i)).toBeTruthy();
    });
  });

  it('renders all-complete state', async () => {
    mockedService.getApplicationProgress.mockResolvedValue({
      ...baseApplication,
      status: 'approved',
      steps: baseApplication.steps.map((s) => ({ ...s, status: 'complete' })),
    });

    const { getByText, getAllByTestId } = render(
      <AdoptionScreen applicationId="app-1" />,
    );

    await waitFor(() => {
      expect(getByText(/application approved/i)).toBeTruthy();
    });

    const statuses = getAllByTestId(/^step-status-/);
    statuses.forEach((node) => {
      expect(node).toHaveTextContent('Complete');
    });
  });

  it('flags overdue steps and documents', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mockedService.getApplicationProgress.mockResolvedValue({
      ...baseApplication,
      steps: [
        {
          ...baseApplication.steps[1],
          dueDate: past,
        },
      ],
    });

    const { getByTestId, getByText } = render(
      <AdoptionScreen applicationId="app-1" />,
    );

    await waitFor(() => {
      expect(getByTestId('step-overdue-step-2')).toBeTruthy();
    });

    expect(getByText(/overdue/i)).toBeTruthy();
  });

  it('displays cached data when offline', async () => {
    setupNetwork(false);
    mockedService.getCachedApplicationProgress.mockResolvedValue(
      baseApplication,
    );

    const { getByText } = render(<AdoptionScreen applicationId="app-1" />);

    await waitFor(() => {
      expect(getByText('Home visit')).toBeTruthy();
    });

    expect(getByText(/offline/i)).toBeTruthy();
    expect(mockedService.getApplicationProgress).not.toHaveBeenCalled();
  });

  it('does not expose another applicant’s information', async () => {
    mockedService.getApplicationProgress.mockResolvedValue({
      ...baseApplication,
      otherApplicants: [
        {
          id: 'user-2',
          name: 'Secret Applicant',
          email: 'secret@example.com',
        },
      ],
    });

    const { queryByText } = render(<AdoptionScreen applicationId="app-1" />);

    await waitFor(() => {
      expect(mockedService.getApplicationProgress).toHaveBeenCalled();
    });

    expect(queryByText('Secret Applicant')).toBeNull();
    expect(queryByText('secret@example.com')).toBeNull();
  });

  it('exposes accessible labels and roles for steps and documents', async () => {
    mockedService.getApplicationProgress.mockResolvedValue(baseApplication);

    const { getByTestId, getAllByRole } = render(
      <AdoptionScreen applicationId="app-1" />,
    );

    await waitFor(() => {
      expect(getByTestId('step-item-step-2')).toBeTruthy();
    });

    const step = getByTestId('step-item-step-2');
    expect(step.props.accessibilityRole).toBe('summary');
    expect(step.props.accessibilityLabel).toMatch(/Home visit/);
    expect(step.props.accessibilityLabel).toMatch(/in progress/i);

    const doc = getByTestId('document-item-doc-1');
    expect(doc.props.accessibilityRole).toBe('text');
    expect(doc.props.accessibilityLabel).toMatch(/Proof of residence/);

    const lists = getAllByRole('list');
    expect(lists.length).toBeGreaterThan(0);
  });
});