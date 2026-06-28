import { darkTheme, lightTheme } from '../colors';
import { contrastRatio, passesWcagAA } from '../contrast';

describe('theme contrast', () => {
  it('keeps core dark mode text pairs above WCAG AA contrast', () => {
    // Standard text on all dark mode backgrounds
    const darkBackgrounds = [
      darkTheme.background,
      darkTheme.surface,
      darkTheme.card,
      darkTheme.cardElevated,
      darkTheme.input,
      darkTheme.subtle,
    ];

    for (const bg of darkBackgrounds) {
      expect(passesWcagAA(darkTheme.text, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.secondaryText, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.placeholder, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.accent, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.info, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.warning, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.error, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.success, bg)).toBe(true);
      expect(passesWcagAA(darkTheme.notification, bg)).toBe(true);
    }
  });

  it('keeps core light mode text pairs above WCAG AA contrast', () => {
    const lightBackgrounds = [
      lightTheme.background,
      lightTheme.surface,
      lightTheme.card,
      lightTheme.cardElevated,
      lightTheme.input,
      lightTheme.subtle,
      lightTheme.white,
    ];

    for (const bg of lightBackgrounds) {
      expect(passesWcagAA(lightTheme.text, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.secondaryText, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.placeholder, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.accent, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.info, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.warning, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.error, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.success, bg)).toBe(true);
      expect(passesWcagAA(lightTheme.notification, bg)).toBe(true);
    }
  });

  it('calculates known contrast ratios', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
  });
});
