# Mobile performance, responsiveness & RTL

This document covers four cross-cutting concerns and the utilities that back
them. All helpers live in `src/utils` and are unit-tested in
`src/utils/__tests__`.

## 1. Startup performance & memory budgets (`startupBudget.ts`)

Providers, update checks, notification tasks, widgets and Sentry all initialise
in `App.tsx`. `startupBudget.ts` declares how long that is allowed to take and
how much memory the app may hold shortly after the first frame.

| Platform | Phase | Time-to-interactive | Resident memory |
| -------- | ----- | ------------------- | --------------- |
| iOS      | cold  | 1800 ms             | 180 MiB         |
| iOS      | warm  | 700 ms              | 180 MiB         |
| Android  | cold  | 2400 ms             | 220 MiB         |
| Android  | warm  | 900 ms              | 220 MiB         |

Budgets target the slowest officially-supported reference devices (iPhone SE
2nd gen; a Pixel 4a-class Android). A measurement may exceed budget by up to
`REGRESSION_TOLERANCE` (10%) to absorb device/CI jitter before it counts as a
**material regression**.

### Wiring it up

- **Runtime:** call `reportStartupMeasurement({ phase, timeToInteractiveMs,
  residentMemoryMiB })` once the first interactive frame renders. It records
  Sentry metrics (`startup.cold.tti_ms`, `startup.cold.memory_mib`, …) and the
  matching performance budgets.
- **CI:** feed the numbers collected from an instrumented build into
  `assertStartupBudgets([...])`. It throws with a combined message listing every
  regression, which fails the performance job.

`checkStartupBudget` is pure — use it to characterise current behaviour before
changing launch code.

## 2. Long-list virtualization (`listVirtualization.ts`)

Rendering full datasets (medical history, notification centre, vet directory)
inflates memory and input latency. Apply the shared presets instead of
per-screen guesses:

```tsx
import {
  virtualizedListProps,
  stableKeyExtractor,
  fixedItemLayout,
} from '../utils/listVirtualization';

<FlatList
  {...virtualizedListProps('long')}      // 'default' | 'long' | 'huge'
  keyExtractor={stableKeyExtractor}       // domain id → falls back to index + warns
  getItemLayout={fixedItemLayout(ROW_HEIGHT, HEADER_HEIGHT)}
/>
```

- `stableKeyExtractor` prefers `id` / `_id` / `key` / `uuid` and warns once in
  dev when it has to fall back to an index key (which defeats recycling and
  loses scroll/focus anchoring).
- `fixedItemLayout` / `variableItemLayout` give `getItemLayout` so
  `scrollToIndex` is O(1) and the list does not re-measure every row on update.
- `preserveScrollAnchor(prev, next, topVisibleIndex)` returns the index to keep
  the viewport pinned to when rows are inserted/removed above the fold.

## 3. Responsive large screens (`twoPaneLayout.ts`)

Fixed phone layouts waste space on tablets/foldables and break on window
resize. `computeTwoPaneLayout(window)` returns a layout decision derived from
the **current** window size:

- `< 720 dp` wide → single scrolling column, detail routes are `push`ed.
- `>= 720 dp` wide → master/detail split; the master pane is `MASTER_PANE_WIDTH`
  (340 dp), capped at 42% of the window, and detail content swaps `inline`.

Use the `useTwoPaneLayout()` hook inside screens — it is built on
`useResponsive()` and re-flows live on orientation, foldable unfold and
split-screen changes. `getTwoPaneLayout()` is the non-hook accessor for
navigators.

## 4. RTL coverage (`rtl.ts`)

Arabic layout can break directional icons, gestures, chart axes and field
order. Route every direction-sensitive choice through `rtl.ts` rather than
hard-coding `left`/`right`/`row`:

| Helper                   | LTR              | RTL              |
| ------------------------ | ---------------- | ---------------- |
| `rowDirection()`         | `row`            | `row-reverse`    |
| `textAlign('start')`     | `left`           | `right`          |
| `forwardChevron()`       | `chevron-right`  | `chevron-left`   |
| `physicalEdge('start')`  | `left`           | `right`          |
| `directionalSign()`      | `1`              | `-1`             |

`directionForLanguage(lang)` resolves direction for an explicit locale without
touching global `I18nManager` state — use it in screenshot/interaction tests
that render a specific Arabic flow.

## Privacy note

None of these helpers log health records, contact details, precise location,
wallet material or tokens. Startup metrics carry only timings, memory figures
and the platform string.
