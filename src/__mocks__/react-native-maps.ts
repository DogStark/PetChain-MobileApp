/**
 * Jest mock for react-native-maps.
 * Provides lightweight stubs so tests that import VetMapScreen or mapService
 * don't fail due to the native module not being available in the Node test env.
 */

import React from 'react';

const MockMapView = ({ children }: { children?: React.ReactNode }) =>
  React.createElement('View', { testID: 'MapView' }, children);

const MockMarker = ({ children }: { children?: React.ReactNode }) =>
  React.createElement('View', { testID: 'Marker' }, children);

const MockCallout = ({ children }: { children?: React.ReactNode }) =>
  React.createElement('View', { testID: 'Callout' }, children);

const MockUrlTile = () => React.createElement('View', { testID: 'UrlTile' });

MockMapView.Animated = MockMapView;

export default MockMapView;
export { MockMarker as Marker, MockCallout as Callout, MockUrlTile as UrlTile };
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
