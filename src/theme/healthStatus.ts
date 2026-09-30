/**
 * healthStatus.ts
 *
 * Color-blind-safe, high-contrast health status tokens (WCAG 1.4.1 Use of Color).
 *
 * Severity and trend must never be conveyed by hue alone. Every status here
 * carries three redundant cues:
 *  - `label`   — the status in words ("Critical", "Improving")
 *  - `icon`    — a distinct glyph name, shape-differentiated not color-differentiated
 *  - `shape`   — badge outline style for a non-glyph fallback
 * Colours use an Okabe–Ito-derived palette that stays distinguishable under
 * protanopia / deuteranopia / tritanopia, and each foreground is tuned to clear
 * WCAG AA (4.5:1) on both the light and dark surface colours.
 */

export type HealthSeverity = 'critical' | 'warning' | 'caution' | 'normal' | 'unknown';
export type HealthTrend = 'improving' | 'declining' | 'steady';

export interface HealthStatusToken {
  label: string;
  /** icon family name — pick shapes that differ without colour */
  icon: string;
  shape: 'filled-triangle' | 'filled-diamond' | 'filled-circle' | 'outline-circle' | 'dashed-circle';
  /** text/glyph colour, light theme */
  fgLight: string;
  /** text/glyph colour, dark theme */
  fgDark: string;
}

export const healthSeverityTokens: Record<HealthSeverity, HealthStatusToken> = {
  critical: {
    label: 'Critical',
    icon: 'alert-octagon',
    shape: 'filled-triangle',
    fgLight: '#B2141B', // deep red
    fgDark: '#FF9AA0',
  },
  warning: {
    label: 'Needs attention',
    icon: 'alert-triangle',
    shape: 'filled-diamond',
    fgLight: '#8A4B00', // vermillion-brown
    fgDark: '#F0A657',
  },
  caution: {
    label: 'Monitor',
    icon: 'eye',
    shape: 'outline-circle',
    fgLight: '#6B5300', // dark amber
    fgDark: '#E4C441',
  },
  normal: {
    label: 'Healthy',
    icon: 'check-circle',
    shape: 'filled-circle',
    fgLight: '#0B6B3A', // bluish green
    fgDark: '#5FD08D',
  },
  unknown: {
    label: 'No data',
    icon: 'help-circle',
    shape: 'dashed-circle',
    fgLight: '#3F4B5F',
    fgDark: '#AEB9CC',
  },
};

export const healthTrendTokens: Record<HealthTrend, HealthStatusToken> = {
  improving: {
    label: 'Improving',
    icon: 'arrow-up-right',
    shape: 'filled-circle',
    fgLight: '#0B6B3A',
    fgDark: '#5FD08D',
  },
  declining: {
    label: 'Declining',
    icon: 'arrow-down-right',
    shape: 'filled-triangle',
    fgLight: '#B2141B',
    fgDark: '#FF9AA0',
  },
  steady: {
    label: 'Steady',
    icon: 'arrow-right',
    shape: 'outline-circle',
    fgLight: '#3F4B5F',
    fgDark: '#AEB9CC',
  },
};

/** Spoken / visible string combining every non-colour cue. */
export function describeHealthStatus(
  severity: HealthSeverity,
  trend?: HealthTrend,
): string {
  const s = healthSeverityTokens[severity].label;
  if (!trend) return s;
  return `${s}, ${healthTrendTokens[trend].label.toLowerCase()}`;
}

/** Resolve the foreground colour for the active theme. */
export function healthStatusColor(
  token: HealthStatusToken,
  theme: 'light' | 'dark',
): string {
  return theme === 'light' ? token.fgLight : token.fgDark;
}
