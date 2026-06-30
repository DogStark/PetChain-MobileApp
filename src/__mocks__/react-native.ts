/**
 * Minimal React Native mock for Jest (node test environment).
 * Only stubs the APIs actually used in tested files.
 */

const React = require('react');

const host = (name: string) =>
  function MockHostComponent({ children, ...props }: Record<string, unknown>) {
    return React.createElement(name, props, children);
  };

const ReactNative = {
  Alert: {
    alert: jest.fn(),
  },
  Image: host('Image'),
  Linking: {
    openURL: jest.fn().mockResolvedValue(true),
    canOpenURL: jest.fn().mockResolvedValue(true),
  },
  Share: {
    share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
  },
  Platform: {
    OS: 'ios',
    select: (obj: Record<string, unknown>) => obj['ios'] ?? obj['default'],
  },
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    flatten: (style: unknown) => style,
  },
  Dimensions: {
    get: jest.fn(() => ({ width: 375, height: 812 })),
  },
  ActivityIndicator: host('ActivityIndicator'),
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: host('Modal'),
  RefreshControl: host('RefreshControl'),
  SafeAreaView: host('SafeAreaView'),
  ScrollView: host('ScrollView'),
  StatusBar: host('StatusBar'),
  Text: host('Text'),
  TextInput: host('TextInput'),
  TouchableOpacity: host('TouchableOpacity'),
  View: host('View'),
};

// FlatList mock — renders ListHeaderComponent, items, ListFooterComponent so
// that tests can find elements placed in any of those sections.
(ReactNative as any).FlatList = function FlatListMock(props: Record<string, unknown>) {
  const {
    data = [],
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListEmptyComponent,
    ListFooterComponent,
    // refreshControl and other props are intentionally ignored
    children,
    ...rest
  } = props;

  const headerEl =
    ListHeaderComponent != null
      ? typeof ListHeaderComponent === 'function'
        ? React.createElement(ListHeaderComponent as Function)
        : ListHeaderComponent
      : null;

  const dataArr = Array.isArray(data) ? (data as unknown[]) : [];
  const items =
    dataArr.length > 0 && typeof renderItem === 'function'
      ? dataArr.map((item, index) =>
          React.createElement(
            React.Fragment,
            {
              key:
                typeof keyExtractor === 'function'
                  ? (keyExtractor as Function)(item, index)
                  : String(index),
            },
            (renderItem as Function)({ item, index }),
          ),
        )
      : ListEmptyComponent != null
        ? typeof ListEmptyComponent === 'function'
          ? React.createElement(ListEmptyComponent as Function)
          : ListEmptyComponent
        : (children ?? null);

  const footerEl =
    ListFooterComponent != null
      ? typeof ListFooterComponent === 'function'
        ? React.createElement(ListFooterComponent as Function)
        : ListFooterComponent
      : null;

  return React.createElement('FlatList', rest, headerEl, items, footerEl);
};

module.exports = ReactNative;
