import { I18nManager, type FlexStyle, type TextStyle } from 'react-native';

import { isRTL } from '../i18n';

/**
 * Direction-aware layout and bidirectional (BiDi) text helpers.
 *
 * RTL locales (Arabic) can silently break icons that imply direction, swipe
 * gestures, chart axes, the visual order of form fields, and mixed-direction
 * medical dosages or record identifiers. Routing every direction-sensitive
 * decision through these helpers — instead of hard-coding `left` / `right` /
 * `row` — keeps navigation, clinical forms, and health charts readable in both
 * directions and gives us a single surface to regression-test.
 */

/** Unicode Left-to-Right Isolate (U+2066) */
export const LRI = '\u2066';
/** Unicode Right-to-Left Isolate (U+2067) */
export const RLI = '\u2067';
/** Unicode First Strong Isolate (U+2068) */
export const FSI = '\u2068';
/** Unicode Pop Directional Isolate (U+2069) */
export const PDI = '\u2069';
/** Unicode Left-to-Right Mark (U+200E) */
export const LRM = '\u200E';

const RTL_SCRIPT_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Embedded LTR clinical tokens inside RTL prose:
 * matches Latin drug names, dosages with units (e.g. "250 mg/5 mL", "5 mg/kg",
 * "10.2-11.5 kg"), ISO dates ("2026-08-28"), and alphanumeric identifiers
 * ("PET-2026-0042").
 */
const EMBEDDED_LTR_SEGMENT_REGEX =
  /[A-Za-z0-9]+(?:[./:%+-][A-Za-z0-9]+)*(?:\s+(?:mg\/kg|mg\/mL|mg|mL|ml|kg|lb|mcg|IU|bpm|mmHg|q\d+h|BID|TID|SID|PRN|PO|IV|IM|SC)\b(?:\s*\/\s*[A-Za-z0-9]+)*)*/g;

/**
 * Icons that convey navigation or horizontal progression and therefore must
 * mirror in RTL layouts. Symmetrical, status, or universal symbols (checkmarks,
 * clocks, warning triangles, shields) must NOT be flipped.
 */
const DIRECTIONAL_ICONS = new Set([
  'chevron-left',
  'chevron-right',
  'arrow-left',
  'arrow-right',
  'arrow-back',
  'arrow-forward',
  'arrow-up-right',
  'arrow-down-right',
  'caret-left',
  'caret-right',
  'send',
  'reply',
  'share',
  'log-out',
  'external-link',
]);

export type FormFieldKind = 'text' | 'medical-note' | 'identifier' | 'numeric' | 'dosage';

export interface IdentifierFormatOptions {
  /** Redact middle characters for privacy-by-default display until revealed. */
  maskSensitive?: boolean;
  /** Number of leading characters to keep visible when masked (default 4). */
  visiblePrefix?: number;
  /** Number of trailing characters to keep visible when masked (default 4). */
  visibleSuffix?: number;
}

export interface RtlFlowStateInput {
  lang: string;
  /** Server-confirmed permission to access the flow (defaults to true for public chrome). */
  hasServerPermission?: boolean;
  /** Whether the client is currently offline. */
  isOffline?: boolean;
  /** Cached direction persisted from the last online session. */
  cachedDirection?: 'ltr' | 'rtl';
}

export interface RtlFlowState {
  direction: 'ltr' | 'rtl';
  isRTL: boolean;
  allowed: boolean;
  usingCachedDirection: boolean;
}

/** Whether the layout is currently right-to-left. */
export function isLayoutRTL(): boolean {
  return Boolean(I18nManager.isRTL);
}

/** Pick the value that matches the current writing direction. */
export function directionalValue<T>(ltr: T, rtl: T): T {
  return isLayoutRTL() ? rtl : ltr;
}

/** `flexDirection` for a horizontal strip that should follow reading order. */
export function rowDirection(reverse = false): FlexStyle['flexDirection'] {
  const rtl = reverse ? !isLayoutRTL() : isLayoutRTL();
  return rtl ? 'row-reverse' : 'row';
}

/** Default text alignment for the current direction. */
export function textAlign(align: 'start' | 'end' | 'center' = 'start'): TextStyle['textAlign'] {
  if (align === 'center') return 'center';
  const start = directionalValue<'left' | 'right'>('left', 'right');
  return align === 'start' ? start : start === 'left' ? 'right' : 'left';
}

/**
 * Name of the chevron / arrow that visually points "forward" (deeper into a
 * navigation stack) for the current direction. Back is the mirror of this.
 */
export function forwardChevron(): 'chevron-right' | 'chevron-left' {
  return directionalValue('chevron-right', 'chevron-left');
}

export function backChevron(): 'chevron-right' | 'chevron-left' {
  return directionalValue('chevron-left', 'chevron-right');
}

/**
 * Map a logical edge (`start` / `end`) to a physical one for APIs that do not
 * understand logical props (some chart libs, `Animated` transforms).
 */
export function physicalEdge(edge: 'start' | 'end'): 'left' | 'right' {
  const start = directionalValue<'left' | 'right'>('left', 'right');
  return edge === 'start' ? start : start === 'left' ? 'right' : 'left';
}

/** Sign to apply to a horizontal translate/swipe delta so "forward" is consistent. */
export function directionalSign(): 1 | -1 {
  return isLayoutRTL() ? -1 : 1;
}

/**
 * Resolve the direction for an explicit language code (independent of the
 * global `I18nManager` state) — used by screenshot tests that render a specific
 * locale without reloading the app.
 */
export function directionForLanguage(lang: string): 'ltr' | 'rtl' {
  if (!lang || typeof lang !== 'string') return 'ltr';
  const normalized = lang.trim().toLowerCase().split(/[-_]/)[0];
  return isRTL(normalized) ? 'rtl' : 'ltr';
}

/**
 * Synchronize React Native's `I18nManager` with the selected locale code.
 * Returns the resolved direction and whether the native RTL flag changed.
 */
export function applyLocaleDirection(lang: string): {
  direction: 'ltr' | 'rtl';
  isRTL: boolean;
  changed: boolean;
} {
  const direction = directionForLanguage(lang);
  const nextIsRtl = direction === 'rtl';
  const previousIsRtl = isLayoutRTL();

  if (typeof I18nManager.allowRTL === 'function') {
    I18nManager.allowRTL(nextIsRtl);
  }
  if (typeof I18nManager.forceRTL === 'function') {
    I18nManager.forceRTL(nextIsRtl);
  }
  (I18nManager as { isRTL: boolean }).isRTL = nextIsRtl;

  return {
    direction,
    isRTL: nextIsRtl,
    changed: previousIsRtl !== nextIsRtl,
  };
}

/**
 * Determine whether an icon should be mirrored horizontally in RTL mode.
 * Non-directional icons (checkmarks, warning badges, clocks) stay unflipped.
 */
export function shouldMirrorIcon(iconName: string): boolean {
  if (!iconName) return false;
  return DIRECTIONAL_ICONS.has(iconName.trim().toLowerCase());
}

/**
 * Compute a `transform` style for an icon so directional glyphs mirror in RTL
 * while status/medical icons remain untouched.
 */
export function directionalIconTransform(
  iconName: string,
  rtl: boolean = isLayoutRTL(),
): { transform: [{ scaleX: 1 | -1 }] } {
  const scaleX: 1 | -1 = rtl && shouldMirrorIcon(iconName) ? -1 : 1;
  return { transform: [{ scaleX }] };
}

/**
 * Order chart series points along the active reading axis without mutating the
 * source array. In RTL mode, chronological progression flows right-to-left.
 */
export function chartAxisOrder<T>(points: readonly T[], rtl: boolean = isLayoutRTL()): T[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const copy = [...points];
  return rtl ? copy.reverse() : copy;
}

/**
 * Resolve `textAlign` and `writingDirection` for clinical form inputs so
 * identifiers, dosages, and numeric measurements stay left-to-right even inside
 * an RTL screen, while free-text clinical notes follow the active locale.
 */
export function formFieldAlignment(
  fieldKind: FormFieldKind,
  rtl: boolean = isLayoutRTL(),
): { textAlign: 'left' | 'right'; writingDirection: 'ltr' | 'rtl' } {
  if (fieldKind === 'identifier' || fieldKind === 'numeric' || fieldKind === 'dosage') {
    return {
      textAlign: rtl ? 'right' : 'left',
      writingDirection: 'ltr',
    };
  }
  return {
    textAlign: rtl ? 'right' : 'left',
    writingDirection: rtl ? 'rtl' : 'ltr',
  };
}

/**
 * Wrap a technical or clinical LTR token (e.g. `"5 mg/kg"`, `"PET-2026-0042"`)
 * in Unicode Left-to-Right Isolates (`U+2066` + `U+200E` ... `U+2069`) so its
 * internal punctuation (`/`, `-`, `:`, `.`) never scrambles inside RTL text.
 */
export function isolateLtrToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(LRI) && trimmed.endsWith(PDI)) {
    return trimmed;
  }
  return `${LRI}${LRM}${trimmed}${PDI}`;
}

/**
 * Format a technical identifier (pet ID, microchip number, Stellar public key,
 * or transaction hash) so it stays readable in mixed-direction layouts, with
 * optional privacy-by-default masking.
 */
export function formatMixedDirectionIdentifier(
  identifier: string,
  options: IdentifierFormatOptions = {},
): string {
  const clean = (identifier ?? '').trim();
  if (!clean) return '';

  const { maskSensitive = false, visiblePrefix = 4, visibleSuffix = 4 } = options;
  let formatted = clean;

  if (maskSensitive) {
    if (clean.length <= visiblePrefix + visibleSuffix) {
      formatted = '••••';
    } else {
      const prefix = clean.slice(0, Math.max(0, visiblePrefix));
      const suffix = clean.slice(clean.length - Math.max(0, visibleSuffix));
      formatted = `${prefix}••••${suffix}`;
    }
  }

  return isolateLtrToken(formatted);
}

/**
 * Preserve the visual order of embedded LTR medical tokens (drug names,
 * concentrations like `"250 mg/5 mL"`, dosages like `"5 mg/kg"`, frequencies
 * like `"BID"`, and ISO dates) when rendered in RTL or mixed-direction strings.
 */
export function formatMixedDirectionMedicalString(
  text: string,
  rtl: boolean = isLayoutRTL(),
): string {
  if (!text) return '';
  const hasRtlChars = RTL_SCRIPT_REGEX.test(text);
  if (!hasRtlChars && !rtl) {
    return text;
  }

  return text.replace(EMBEDDED_LTR_SEGMENT_REGEX, (match) => isolateLtrToken(match));
}

/**
 * Resolve RTL flow state for a screen, honoring server-confirmed permissions
 * and falling back to cached direction when offline.
 */
export function resolveRtlFlowState({
  lang,
  hasServerPermission = true,
  isOffline = false,
  cachedDirection,
}: RtlFlowStateInput): RtlFlowState {
  const computedDirection = directionForLanguage(lang);
  const usingCachedDirection = Boolean(isOffline && !lang?.trim() && cachedDirection);
  const direction = usingCachedDirection && cachedDirection ? cachedDirection : computedDirection;

  return {
    direction,
    isRTL: direction === 'rtl',
    allowed: Boolean(hasServerPermission),
    usingCachedDirection,
  };
}

export default {
  LRI,
  RLI,
  FSI,
  PDI,
  LRM,
  isLayoutRTL,
  directionalValue,
  rowDirection,
  textAlign,
  forwardChevron,
  backChevron,
  physicalEdge,
  directionalSign,
  directionForLanguage,
  applyLocaleDirection,
  shouldMirrorIcon,
  directionalIconTransform,
  chartAxisOrder,
  formFieldAlignment,
  isolateLtrToken,
  formatMixedDirectionIdentifier,
  formatMixedDirectionMedicalString,
  resolveRtlFlowState,
};
