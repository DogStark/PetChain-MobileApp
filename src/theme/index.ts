import { darkTheme, lightTheme, navigationDarkTheme, navigationLightTheme } from './colors';
import { tokens } from './tokens';
import { useTheme as useThemePreference } from '../context/ThemeContext';

/**
 * Hook to retrieve the current application colors, ensuring WCAG AA
 * contrast compliance for all standard and secondary/tertiary colors.
 */
export function useAppTheme() {
  const { colors } = useThemePreference();
  return colors;
}

/**
 * Hook to retrieve the navigation theme configuration aligned with
 * accessibility and contrast standards.
 */
export function useNavigationTheme() {
  const { theme } = useThemePreference();
  return theme === 'dark' ? navigationDarkTheme : navigationLightTheme;
}

export { tokens, lightTheme, darkTheme, navigationLightTheme, navigationDarkTheme };
export { contrastRatio, passesWcagAA } from './contrast';
