import type { FlatListProps } from 'react-native';

/**
 * Shared virtualization presets for long medical, notification and directory
 * lists.
 *
 * Rendering a full dataset in one pass inflates memory and input latency. These
 * presets keep `FlatList`/`SectionList` windowed, give every row a stable key,
 * and — when rows are a fixed height — provide `getItemLayout` so scrolling to
 * an offset and preserving scroll position across data updates is O(1).
 *
 * Usage:
 *   <FlatList
 *     {...virtualizedListProps('long')}
 *     keyExtractor={stableKeyExtractor}
 *     getItemLayout={fixedItemLayout(ROW_HEIGHT)}
 *   />
 */

export type ListSize = 'default' | 'long' | 'huge';

type VirtualizationProps = Pick<
  FlatListProps<unknown>,
  | 'windowSize'
  | 'maxToRenderPerBatch'
  | 'updateCellsBatchingPeriod'
  | 'initialNumToRender'
  | 'removeClippedSubviews'
  | 'onEndReachedThreshold'
>;

/**
 * Tuned windowing configs. `long` roughly halves the retained cell count vs.
 * the RN defaults; `huge` is for unbounded feeds (forum, global search).
 */
export const VIRTUALIZATION_PRESETS: Record<ListSize, VirtualizationProps> = {
  default: {
    windowSize: 21,
    maxToRenderPerBatch: 10,
    updateCellsBatchingPeriod: 50,
    initialNumToRender: 10,
    removeClippedSubviews: true,
    onEndReachedThreshold: 0.5,
  },
  long: {
    windowSize: 11,
    maxToRenderPerBatch: 8,
    updateCellsBatchingPeriod: 60,
    initialNumToRender: 8,
    removeClippedSubviews: true,
    onEndReachedThreshold: 0.6,
  },
  huge: {
    windowSize: 7,
    maxToRenderPerBatch: 6,
    updateCellsBatchingPeriod: 80,
    initialNumToRender: 6,
    removeClippedSubviews: true,
    onEndReachedThreshold: 0.75,
  },
};

export function virtualizedListProps(size: ListSize = 'long'): VirtualizationProps {
  return VIRTUALIZATION_PRESETS[size];
}

/**
 * Key extractor that prefers a stable domain id and only falls back to the
 * list index when nothing better exists. An index-only key defeats
 * virtualization recycling and loses focus/scroll anchoring when the data
 * mutates, so we warn (once) in dev when we have to use it.
 */
export interface HasStableId {
  id?: string | number;
  _id?: string | number;
  key?: string | number;
  uuid?: string | number;
}

let warnedAboutIndexKeys = false;

export function stableKeyExtractor(item: HasStableId, index: number): string {
  const id = item?.id ?? item?._id ?? item?.key ?? item?.uuid;
  if (id !== undefined && id !== null) return String(id);

  if (__DEV__ && !warnedAboutIndexKeys) {
    warnedAboutIndexKeys = true;
    console.warn(
      '[listVirtualization] Falling back to index keys — provide a stable `id` ' +
        'on list items to preserve scroll/focus across updates.',
    );
  }
  return `idx-${index}`;
}

/**
 * `getItemLayout` for lists whose rows are a known fixed height (optionally with
 * a leading header). Enables constant-time `scrollToIndex` and stops the list
 * from re-measuring every visible row after a data change.
 */
export function fixedItemLayout(rowHeight: number, headerHeight = 0) {
  return (
    _data: ArrayLike<unknown> | null | undefined,
    index: number,
  ): { length: number; offset: number; index: number } => ({
    length: rowHeight,
    offset: headerHeight + rowHeight * index,
    index,
  });
}

/**
 * Build `getItemLayout` for a list of variable-height rows from a
 * `heightForItem` callback. Offsets are memoised across calls within the same
 * render so a full list layout stays O(n) rather than O(n²).
 */
export function variableItemLayout<T>(
  data: readonly T[],
  heightForItem: (item: T, index: number) => number,
  headerHeight = 0,
) {
  const offsets: number[] = new Array(data.length + 1);
  offsets[0] = headerHeight;
  for (let i = 0; i < data.length; i += 1) {
    offsets[i + 1] = offsets[i] + heightForItem(data[i], i);
  }
  return (_d: ArrayLike<unknown> | null | undefined, index: number) => ({
    length: offsets[index + 1] - offsets[index],
    offset: offsets[index],
    index,
  });
}

/**
 * Given the previous and next data arrays plus the current top visible index,
 * return the index the list should stay anchored to so an in-place update
 * (item prepended/removed above the fold) doesn't jump the viewport.
 */
export function preserveScrollAnchor<T extends HasStableId>(
  prev: readonly T[],
  next: readonly T[],
  topVisibleIndex: number,
): number {
  const anchor = prev[topVisibleIndex];
  if (!anchor) return Math.min(topVisibleIndex, Math.max(0, next.length - 1));

  const anchorKey = stableKeyExtractor(anchor, topVisibleIndex);
  const nextIndex = next.findIndex((it, i) => stableKeyExtractor(it, i) === anchorKey);
  return nextIndex >= 0 ? nextIndex : Math.min(topVisibleIndex, Math.max(0, next.length - 1));
}

export default {
  VIRTUALIZATION_PRESETS,
  virtualizedListProps,
  stableKeyExtractor,
  fixedItemLayout,
  variableItemLayout,
  preserveScrollAnchor,
};
