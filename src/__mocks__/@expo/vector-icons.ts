/**
 * Mock for @expo/vector-icons — prevents Jest from choking on ESM imports.
 */
const mockIcon = 'Icon';

const createMock = (name: string) => {
  const MockIcon = (props: Record<string, unknown>) => null;
  MockIcon.displayName = name;
  MockIcon.glyphMap = {};
  return MockIcon;
};

export const Ionicons = createMock('Ionicons');
export const MaterialIcons = createMock('MaterialIcons');
export const MaterialCommunityIcons = createMock('MaterialCommunityIcons');
export const FontAwesome = createMock('FontAwesome');
export const AntDesign = createMock('AntDesign');
export const Feather = createMock('Feather');

export default {};
