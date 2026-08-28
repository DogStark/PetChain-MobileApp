import { contrastRatio } from '../contrast';
import { darkTheme, lightTheme } from '../colors';
import {
  describeHealthStatus,
  healthSeverityTokens,
  healthStatusColor,
  healthTrendTokens,
} from '../healthStatus';

const AA = 4.5;

describe('health status tokens (issue #982)', () => {
  it('never relies on colour alone — every status has a label, icon and shape', () => {
    for (const token of [
      ...Object.values(healthSeverityTokens),
      ...Object.values(healthTrendTokens),
    ]) {
      expect(token.label.length).toBeGreaterThan(0);
      expect(token.icon.length).toBeGreaterThan(0);
      expect(token.shape.length).toBeGreaterThan(0);
    }
  });

  it('uses distinct shapes so severity is distinguishable without hue', () => {
    const shapes = Object.values(healthSeverityTokens).map((t) => t.shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('meets WCAG AA contrast on every light-theme surface', () => {
    const backgrounds = [lightTheme.background, lightTheme.surface, lightTheme.card, lightTheme.subtle];
    for (const token of Object.values(healthSeverityTokens)) {
      for (const bg of backgrounds) {
        expect(contrastRatio(token.fgLight, bg)).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('meets WCAG AA contrast on every dark-theme surface', () => {
    const backgrounds = [darkTheme.background, darkTheme.surface, darkTheme.card, darkTheme.cardElevated];
    for (const token of Object.values(healthSeverityTokens)) {
      for (const bg of backgrounds) {
        expect(contrastRatio(token.fgDark, bg)).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('trend tokens also clear AA in both themes', () => {
    for (const token of Object.values(healthTrendTokens)) {
      expect(contrastRatio(token.fgLight, lightTheme.surface)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(token.fgDark, darkTheme.surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('resolves the foreground colour for the active theme', () => {
    expect(healthStatusColor(healthSeverityTokens.critical, 'light')).toBe(
      healthSeverityTokens.critical.fgLight,
    );
    expect(healthStatusColor(healthSeverityTokens.critical, 'dark')).toBe(
      healthSeverityTokens.critical.fgDark,
    );
  });

  it('builds a spoken description combining severity and trend', () => {
    expect(describeHealthStatus('critical')).toBe('Critical');
    expect(describeHealthStatus('warning', 'declining')).toBe('Needs attention, declining');
    expect(describeHealthStatus('normal', 'improving')).toBe('Healthy, improving');
  });
});
