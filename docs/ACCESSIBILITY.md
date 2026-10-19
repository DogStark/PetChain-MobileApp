# Accessibility guidelines

Shared building blocks that keep PetChain usable with screen readers, reduced
motion, and non-colour perception. All are unit-testable pure modules plus thin
React wrappers.

## Screen-reader summaries for data views (`src/utils/a11yChartSummary.ts`)

Charts and the vet map render as one opaque view to VoiceOver / TalkBack. For any
such view provide the non-visual equivalent:

| Helper | Use for |
| --- | --- |
| `buildChartSummary` | One-line spoken summary on the chart region (`accessibilityLabel`). Includes count, latest value, trend, and range. |
| `buildChartDataTable` | Ordered `string[]`, one focusable row per plotted point. |
| `buildMapSummary` | One-line summary for the map region; mirrors the active filter and offline state. |
| `buildClinicListSummary` | Nearest-first `string[]` equivalent of the map pins. No coordinates or phone numbers are spoken. |
| `sectionHeading` | Heading text for a data region; pair with `accessibilityRole="header"`. |

Keep the summary and the visible filter in sync — recompute it whenever the range
or filter changes.

## Modals (`src/components/AccessibleModal.tsx`, `src/hooks/useAccessibleModal.ts`)

Use `AccessibleModal` for every dialog. It moves screen-reader focus to the title
on open, restores focus to `returnFocusRef` on close, handles the Android
hardware back button, and — via the shared `modalStack` — makes sure only the
top-most dialog reacts when modals are nested.

Do not hand-roll `Modal` + `BackHandler` + `setAccessibilityFocus` per screen.

## Reduced motion (`src/utils/motion.ts`)

`useReducedMotion()` returns the live OS "Reduce Motion" preference. Honour it by
removing movement, **not** the state change:

- transitions: `motionDuration(ms, reduceMotion)` / `resolveTransition(ms, reduceMotion)`
- decorative / looping / parallax / gesture-driven animation: gate on `allowDecorativeAnimation(reduceMotion)`
- chart draw-in: start at `chartDrawProgress(reduceMotion)` (jumps to the final frame)

## Adoption application progress (`src/screens/adoption/ApplicationProgressScreen.tsx`)

The progress view lists each required step, requested document, review status,
and due date for the signed-in applicant only. Keep it compliant:

- **Headings:** render the screen title and each section ("Steps", "Documents",
  "Review status") with `accessibilityRole="header"`; use `sectionHeading` for
  the spoken text so VoiceOver / TalkBack can jump between sections.
- **Steps:** each row is one focusable element whose `accessibilityLabel`
  combines the step name, its status (`describeHealthStatus()`), and the due
  date. Never split a row into several unlabelled fragments.
- **Documents:** label each requested document with its name and state
  ("requested", "uploaded", "approved", "rejected"). Do not speak file paths,
  storage URLs, or reviewer notes.
- **Status:** always pair the colour with the token's `label` / `icon` /
  `shape` (see health status below); never rely on hue alone.
- **Due dates:** speak a full, unambiguous date (e.g. "Due 12 March 2025") and
  include overdue / due-soon wording in the label, not only in the colour.
- **Privacy:** only the current applicant's data is rendered; never include
  another applicant's name, documents, or reviewer comments in any label.
- **Reduced motion:** gate progress-bar fill and any status transitions on
  `useReducedMotion()` / `motionDuration()`; the value still updates, only the
  animation is removed.
- **Stale / offline:** when data is cached or a refresh failed, announce it with
  `AccessibilityInfo.announceForAccessibility` (e.g. "Showing saved progress,
  last updated …") and expose a retry control with an accessible label.

## Colour-independent health status (`src/theme/healthStatus.ts`)

Severity and trend must never rely on hue alone (WCAG 1.4.1). Every status token
carries a text `label`, an `icon`, and a `shape`, and its `fgLight` / `fgDark`
colours are verified to clear WCAG AA (4.5:1) on every surface in
`src/theme/__tests__/healthStatus.test.ts`. Use `describeHealthStatus()` for the
spoken/label string and `healthStatusColor(token, theme)` for the colour.
