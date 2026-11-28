import type { AdoptionApplicationProgress } from '../services/adoptionApplicationProgressService';

export type AdoptionTimelineMilestoneId = 'submitted' | 'reviewed' | 'matched' | 'closed';

export type AdoptionTimelineMilestoneState = 'complete' | 'current' | 'upcoming' | 'attention';

export interface AdoptionTimelineMilestone {
  id: AdoptionTimelineMilestoneId;
  label: string;
  state: AdoptionTimelineMilestoneState;
  /** ISO-8601 timestamp from the server, or null when the milestone has no timestamp yet. */
  timestamp: string | null;
}

/**
 * Maps applicant-scoped progress onto the four rescue case milestones.
 *
 * Only server-provided timestamps are shown. Nothing is inferred from the device clock.
 */
export function buildAdoptionTimeline(
  progress: AdoptionApplicationProgress,
): AdoptionTimelineMilestone[] {
  const { review } = progress;
  const decided = review.status === 'approved' || review.status === 'rejected';
  const rejected = review.status === 'rejected';

  let reviewedState: AdoptionTimelineMilestoneState = 'upcoming';
  if (review.status === 'in-review') reviewedState = 'current';
  if (review.status === 'changes-requested') reviewedState = 'attention';
  if (decided) reviewedState = 'complete';

  const matchedState: AdoptionTimelineMilestoneState = progress.matchedAt
    ? 'complete'
    : review.status === 'approved'
      ? 'current'
      : 'upcoming';

  const closedState: AdoptionTimelineMilestoneState =
    progress.closedAt || rejected ? 'complete' : 'upcoming';

  return [
    {
      id: 'submitted',
      label: 'Submitted',
      state: 'complete',
      timestamp: progress.submittedAt ?? null,
    },
    {
      id: 'reviewed',
      label: 'Reviewed',
      state: reviewedState,
      timestamp: reviewedState === 'upcoming' ? null : (review.updatedAt ?? null),
    },
    {
      id: 'matched',
      label: 'Matched',
      state: matchedState,
      timestamp: progress.matchedAt ?? null,
    },
    {
      id: 'closed',
      label: 'Closed',
      state: closedState,
      timestamp: progress.closedAt ?? (rejected ? (review.updatedAt ?? null) : null),
    },
  ];
}
