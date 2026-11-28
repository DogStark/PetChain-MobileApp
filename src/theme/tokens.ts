export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const typography = {
  fontSizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
  },
  fontWeights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const tokens = {
  spacing,
  typography,
  radii,
};

/**
 * OLED background overrides: pure black (#000000) surfaces for the
 * `dark-oled` theme variant, which saves power on OLED displays.
 */
export const oledBackgroundTokens = {
  background: '#000000',
  surface: '#000000',
  card: '#0A0A0A',
  cardElevated: '#141414',
  input: '#0A0A0A',
  subtle: '#000000',
  muted: '#1A1A1A',
  overlay: 'rgba(0,0,0,0.85)',
  shadow: '#000000',
} as const;
