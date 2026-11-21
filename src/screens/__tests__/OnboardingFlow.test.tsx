import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import MultiStepFormHeader from '../../components/MultiStepFormHeader';
import BiometricStep from '../onboarding/BiometricStep';
import BlockchainIntroStep from '../onboarding/BlockchainIntroStep';
import NotificationsStep from '../onboarding/NotificationsStep';
import PetSetupStep from '../onboarding/PetSetupStep';

jest.mock('react-native-webview', () => ({
  WebView: 'WebView',
}));

const reactNativeMock = require('react-native') as Record<string, unknown>;
if (!reactNativeMock.Switch) {
  reactNativeMock.Switch = 'Switch';
}

function renderTree(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function findTextMatches(root: ReactTestInstance, pattern: RegExp): ReactTestInstance[] {
  return root.findAll(
    (node) => typeof node.props.children === 'string' && pattern.test(node.props.children),
  );
}

describe('Onboarding step UI and MultiStepFormHeader progress indicators', () => {
  it('hides Skip button on mandatory steps (PetSetupStep and NotificationsStep)', () => {
    const onNext = jest.fn();
    const onSkip = jest.fn();

    const petTree = renderTree(<PetSetupStep onNext={onNext} onSkip={onSkip} />);
    expect(findTextMatches(petTree.root, /skip/i)).toHaveLength(0);

    const notifTree = renderTree(<NotificationsStep onNext={onNext} onSkip={onSkip} />);
    expect(findTextMatches(notifTree.root, /skip|not now/i)).toHaveLength(0);
  });

  it('shows Skip button on non-mandatory steps (BiometricStep and BlockchainIntroStep)', () => {
    const onNext = jest.fn();
    const onSkip = jest.fn();

    const bioTree = renderTree(<BiometricStep onNext={onNext} onSkip={onSkip} />);
    const bioSkipBtn = bioTree.root.findByProps({ testID: 'biometric-skip-button' });
    act(() => {
      bioSkipBtn.props.onPress();
    });
    expect(onSkip).toHaveBeenCalledTimes(1);

    const chainTree = renderTree(<BlockchainIntroStep onNext={onNext} onSkip={onSkip} />);
    const chainSkipText = chainTree.root.find(
      (node) => node.props.children === 'Skip' && Boolean(node.parent?.props.onPress),
    );
    act(() => {
      chainSkipText.parent!.props.onPress();
    });
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it('renders distinct completed vs skipped vs current dots on MultiStepFormHeader', () => {
    const tree = renderTree(
      <MultiStepFormHeader
        announcement="Step 4 of 6"
        currentStep={3}
        totalSteps={6}
        completedSteps={[0, 1]}
        skippedSteps={[2]}
      />,
    );

    expect(tree.root.findByProps({ testID: 'progress-dot-0' }).props.accessibilityLabel).toBe(
      'Step 1: completed',
    );
    expect(tree.root.findByProps({ testID: 'progress-dot-1' }).props.accessibilityLabel).toBe(
      'Step 2: completed',
    );
    expect(tree.root.findByProps({ testID: 'progress-dot-2' }).props.accessibilityLabel).toBe(
      'Step 3: skipped',
    );
    expect(tree.root.findByProps({ testID: 'progress-dot-3' }).props.accessibilityLabel).toBe(
      'Step 4: current',
    );
    expect(tree.root.findByProps({ testID: 'progress-dot-4' }).props.accessibilityLabel).toBe(
      'Step 5: upcoming',
    );
  });
});
