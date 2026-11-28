import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import AttachmentReviewState, {
  type AttachmentReviewDisplayStatus,
} from '../AttachmentReviewState';

function getRenderedStrings(tree: ReactTestRenderer): string[] {
  const strings: string[] = [];
  for (const node of tree.root.findAll(() => true)) {
    const children = node.props.children;
    if (typeof children === 'string') {
      strings.push(children);
    } else if (Array.isArray(children)) {
      strings.push(...children.filter((child): child is string => typeof child === 'string'));
    }
  }
  return strings;
}

describe('AttachmentReviewState', () => {
  const states: Array<[AttachmentReviewDisplayStatus, string, string]> = [
    ['uploading', 'Review status: Uploading', 'secure upload completes'],
    ['pending_review', 'Review status: Pending clinician review', 'waiting for clinician review'],
    ['accepted', 'Review status: Accepted', 'accepted this attachment'],
    ['rejected', 'Review status: Rejected', 'submit it for review again'],
    ['expired', 'Review status: Expired', 'request a new review'],
    ['unknown', 'Review status: Review status unavailable', 'Refresh the document list'],
  ];

  it.each(states)('announces the %s state and guidance accessibly', (status, label, guidance) => {
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(<AttachmentReviewState status={status} />);
    });

    expect(tree).not.toBeNull();
    expect(tree!.root.findByProps({ accessibilityLiveRegion: 'polite' })).toBeDefined();
    const strings = getRenderedStrings(tree!);
    expect(strings.join(' ')).toContain(label);
    expect(strings.join(' ')).toContain(guidance);
  });

  it('uses an unavailable state when an older server omits review metadata', () => {
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(<AttachmentReviewState />);
    });

    expect(tree).not.toBeNull();
    expect(getRenderedStrings(tree!).join(' ')).toContain('Review status unavailable');
  });
});
