# RTL Support Status

The app has basic Right-To-Left (RTL) layout support using React Native's built-in `I18nManager.isRTL`. 

## Current Status
- Hardcoded `left`/`right` properties have been replaced with `start`/`end` in core components such as `NotificationItem.tsx` and `SOSButton.tsx`.
- Layouts using `flexDirection: 'row'` naturally flip to `row-reverse` in RTL.
- `paddingHorizontal` and `marginHorizontal` correctly apply padding to the start and end edges.

## Known Issues
- `ScrollView` with `horizontal={true}` (e.g., `PetSelectorBar.tsx`) may not initially scroll to the correct start edge in some older versions of React Native, or the scroll bar may visually be on the wrong side.
- Custom navigation transitions in `AppNavigator.tsx` may still use LTR animations.
- Some third-party libraries may not fully support RTL layouts and will require individual patches or configuration.
