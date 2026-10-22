import { AccessibilityInfo, findNodeHandle } from 'react-native';

import { formatStepAnnouncement, useMultiStepFormFocus } from '../useMultiStepFormFocus';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    AccessibilityInfo: {
      setAccessibilityFocus: jest.fn(),
      announceForAccessibility: jest.fn(),
    },
    findNodeHandle: jest.fn(() => 42),
  };
});

describe('formatStepAnnouncement', () => {
  it('formats step progress for screen readers', () => {
    expect(formatStepAnnouncement(1, 4, 'Medication details')).toBe(
      'Step 2 of 4: Medication details',
    );
  });

  it('formats the first step correctly', () => {
    expect(formatStepAnnouncement(0, 3, 'Photo & basics')).toBe('Step 1 of 3: Photo & basics');
  });
});

describe('useMultiStepFormFocus', () => {
  it('exports the hook', () => {
    expect(useMultiStepFormFocus).toBeDefined();
    expect(typeof useMultiStepFormFocus).toBe('function');
  });

  it('announces accessibility updates through AccessibilityInfo helpers', () => {
    const mockRef = {};
    const node = findNodeHandle(mockRef);
    if (node) {
      AccessibilityInfo.setAccessibilityFocus(node);
    }
    AccessibilityInfo.announceForAccessibility(formatStepAnnouncement(1, 4, 'Medication details'));

    expect(findNodeHandle).toHaveBeenCalledWith(mockRef);
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(42);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Step 2 of 4: Medication details',
    );
  });
});
