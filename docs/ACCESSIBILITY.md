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

## Modals, pickers, and permission prompts (`src/components/AccessibleModal.tsx`, `src/hooks/useAccessibleModal.ts`, `src/utils/focusRecovery.ts`)

Use `AccessibleModal` for every dialog. It moves screen-reader focus to the title
on open, restores focus to `returnFocusRef` (or `fallbackFocusRef` if the primary
trigger was unmounted or disabled) on close, handles the Android hardware back
button, and — via the shared `modalStack` — makes sure only the top-most dialog
reacts when modals are nested.

For native pickers (`ProfilePhotoPicker`) and permission prompts
(`PermissionRationaleModal`), use `restoreFocusToInitiator()` from
`src/utils/focusRecovery.ts` so focus returns deterministically to the initiating
control across iOS, Android, and keyboard/web platforms:

- **Retry & fallback:** `restoreFocusToInitiator(triggerRef, fallbackRef, options)`
  retries focus resolution across frames if the node handle is not yet attached,
  and falls back to `fallbackRef` when the primary control is disabled or unmounted.
- **Server-confirmed permissions & offline continuity:** `evaluateServerPermissionForFocus()`
  verifies server-confirmed permissions while preserving cached grants when offline,
  and announces actionable recovery guidance when a prompt closes due to denial or
  stale data.
- **Privacy by default:** `sanitizeFocusAnnouncement()` redacts Stellar wallet
  addresses, 15-digit microchip numbers, emails, phone numbers, and secret tokens
  before any dismissal announcement is spoken.

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

## Pet travel packing checklist (`src/screens/PackingChecklistScreen.tsx`)

The per-trip packing checklist is fully operable with a screen reader and never
relies on colour or motion to convey progress.

- **Category headings** (Food, Records, Medication, Equipment) use
  `accessibilityRole="header"` so users can jump between sections.
- **Each item** is a checkbox: set `accessibilityRole="checkbox"` with
  `accessibilityState={{ checked }}` and a label that includes both the category
  and the item text (e.g. "Food: kibble"). Never signal checked state with a
  strike-through or colour alone.
- **Progress** ("3 of 8 packed") is announced through a container with
  `accessibilityLiveRegion="polite"`; update the text rather than firing a
  separate announcement on every toggle.
- **Denied and offline states** render through `StateView` — a permission
  denial, a stale/unsynced trip, or an offline load must show an explanatory
  state with a retry action, never an empty list.
- **Reduced motion**: gate any check/expand transitions on
  `allowDecorativeAnimation(reduceMotion)` and shorten them with
  `motionDuration(ms, reduceMotion)`; the checked state itself must still change.

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
