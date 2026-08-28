# App Icons

## Required iOS Icons

- `icon.png` - 1024×1024px (App Store)
- `icon-83.5@2x.png` - 167×167px (iPad Pro)
- `icon-76@2x.png` - 152×152px (iPad)
- `icon-60@3x.png` - 180×180px (iPhone @3x)
- `icon-60@2x.png` - 120×120px (iPhone @2x)
- `icon-40@3x.png` - 120×120px (Spotlight @3x)
- `icon-40@2x.png` - 80×80px (Spotlight @2x)
- `icon-29@3x.png` - 87×87px (Settings @3x)
- `icon-29@2x.png` - 58×58px (Settings @2x)
- `icon-20@2x.png` - 40×40px (Notification @2x)
- `icon-20@3x.png` - 60×60px (Notification @3x)

## Required Android Icons

- `icon.png` - 512×512px (Google Play Store)
- `adaptive-icon.png` - 108×108dp (foreground layer, 432×432px @4x)
- `adaptive-icon-background.png` - 108×108dp (solid color #4A90A4)

Google Play also requires:
- `icon-192.png` - 192×192px (high-res)
- `icon-144.png` - 144×144px
- `icon-96.png` - 96×96px
- `icon-72.png` - 72×72px
- `icon-48.png` - 48×48px

## Splash Screen

- `splash.png` - 1284×2778px (iPhone 14 Pro Max portrait)
  - Background: #4A90A4 (PetChain brand color)
  - Logo centered, white color
  - Alternatively: provide vector source for generation

### Design Guidelines
- No rounded corners — Apple applies mask automatically
- No transparency in final PNG (flat background)
- Use official PetChain brand guidelines if available
- Icons should be recognizable at smallest size (20×20px)

### Generation
Use Expo's asset generation: `npx expo prebuild` will generate icons from source if properly configured.
