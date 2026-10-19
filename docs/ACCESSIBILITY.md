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

## Routine completion streak calendar (`src/components/RoutineStreakCalendar.tsx`)

The streak calendar shows one cell per day, each in one of three states:
**completed**, **skipped**, or **unknown** (no event recorded). Follow these rules:

- **Never encode state by colour alone** (WCAG 1.4.1). Every cell carries a distinct
  `shape` and `icon` in addition to its fill, and exposes a text `label` via
  `accessibilityLabel`. Use the shared status tokens from
  `src/theme/healthStatus.ts` rather than ad-hoc colours.
- **Unknown is not missed.** A day with no recorded event must be announced as
  "no data recorded" and rendered with the neutral unknown shape/icon. Never
  present missing data as a skipped or failed day, visually or to a screen reader.
- **Reduced motion.** Gate the per-cell transition/draw-in animation on
  `allowDecorativeAnimation(reduceMotion)` (or `motionDuration`). The state change
  must still be conveyed; only the movement is removed.
- **Month navigation.** The previous/next month controls must be reachable and
  operable by screen reader: give each a descriptive `accessibilityLabel`
  (e.g. "Previous month, March 2024"), `accessibilityRole="button"`, and a
  disabled state that is announced when at a boundary. Announce the newly shown
  month via `accessibilityLiveRegion` after navigation.
- **Privacy.** Do not speak pet names, notes, or other sensitive details in cell
  labels; keep labels to date + state only.

## Colour-independent health status (`src/theme/healthStatus.ts`)

Severity and trend must never rely on hue alone (WCAG 1.4.1). Every status token
carries a text `label`, an `icon`, and a `shape`, and its `fgLight` / `fgDark`
colours are verified to clear WCAG AA (4.5:1) on every surface in
`src/theme/__tests__/healthStatus.test.ts`. Use `describeHealthStatus()` for the
spoken/label string and `healthStatusColor(token, theme)` for the colour.
