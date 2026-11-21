import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import AuditHistoryScreen from '../AuditHistoryScreen';
import auditTrailService, { type AuditTrailEntry } from '../../services/auditTrailService';

jest.mock('../../utils/secureScreen', () => ({
  useSecureScreen: jest.fn(),
}));

jest.mock('../../utils/dateLocale', () => ({
  formatRelativeTime: jest.fn(() => 'just now'),
}));

jest.mock('../../services/auditTrailService', () => ({
  __esModule: true,
  default: {
    getAuditTrail: jest.fn(),
    exportAuditTrailCsv: jest.fn(),
  },
}));

const mockedGetAuditTrail = auditTrailService.getAuditTrail as jest.Mock;

describe('AuditHistoryScreen co-owner attribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays co-owner actions distinctly from primary owner actions', async () => {
    const entries: AuditTrailEntry[] = [
      {
        id: 'audit-co-owner',
        entityType: 'pet',
        entityId: 'pet-1',
        action: 'UPDATE',
        beforeData: { weightKg: 10 },
        afterData: { weightKg: 11 },
        changedBy: 'user-owner',
        actingUserId: 'user-co-owner',
        onBehalfOfUserId: 'user-owner',
        ipAddress: '127.0.0.1',
        userAgent: 'PetChain/1.0',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'audit-owner',
        entityType: 'pet',
        entityId: 'pet-1',
        action: 'UPDATE',
        beforeData: { name: 'Max' },
        afterData: { name: 'Buddy' },
        changedBy: 'user-owner',
        ipAddress: '127.0.0.1',
        userAgent: 'PetChain/1.0',
        createdAt: new Date().toISOString(),
      },
    ];

    mockedGetAuditTrail.mockResolvedValue(entries);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AuditHistoryScreen entityType="pet" entityId="pet-1" onBack={jest.fn()} />,
      );
      await Promise.resolve();
    });

    expect(mockedGetAuditTrail).toHaveBeenCalledWith({
      entityType: 'pet',
      entityId: 'pet-1',
      limit: 200,
    });

    const coOwnerBadge = renderer.root.findByProps({ testID: 'co-owner-badge-audit-co-owner' });
    expect(coOwnerBadge).toBeTruthy();

    const coOwnerActor = renderer.root.findByProps({ testID: 'audit-actor-audit-co-owner' });
    expect(coOwnerActor.props.children).toBe('Co-owner: user-co-owner (on behalf of user-owner)');

    expect(renderer.root.findAllByProps({ testID: 'co-owner-badge-audit-owner' })).toHaveLength(0);
    const ownerActor = renderer.root.findByProps({ testID: 'audit-actor-audit-owner' });
    expect(ownerActor.props.children).toBe('User: user-owner');
  });
});
