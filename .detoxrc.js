/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/PetChain.app',
      build:
        'xcodebuild -workspace ios/PetChain.xcworkspace -scheme PetChain -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/PetChain.app',
      build:
        'xcodebuild -workspace ios/PetChain.xcworkspace -scheme PetChain -configuration Release -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build:
        'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug && cd ..',
      reversePorts: [8081],
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build:
        'cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release && cd ..',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { type: 'iPhone 15' },
    },
    // Maximum supported dynamic-type size for clinical form coverage.
    'simulator.maxText': {
      type: 'ios.simulator',
      device: { type: 'iPhone 15' },
      // Largest accessibility text size (AX5) so dosage/consent/emergency
      // controls are exercised at the supported platform range.
      bootArgs: '-UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge',
    },
    emulator: {
      type: 'android.emulator',
      device: { avdName: 'Pixel_6_API_33' },
    },
    // Maximum supported font scale for clinical form coverage.
    'emulator.maxText': {
      type: 'android.emulator',
      device: { avdName: 'Pixel_6_API_33' },
      // Largest supported font scale so dosage/consent/emergency controls
      // are exercised at the supported platform range.
      bootArgs: '-prop ro.sf.font_scale 2.0',
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    // Dynamic-type coverage: max font size, English and Spanish.
    'ios.sim.maxText.en': {
      device: 'simulator.maxText',
      app: 'ios.debug',
    },
    'ios.sim.maxText.es': {
      device: 'simulator.maxText',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
    // Dynamic-type coverage: max font size, English and Spanish.
    'android.emu.maxText.en': {
      device: 'emulator.maxText',
      app: 'android.debug',
    },
    'android.emu.maxText.es': {
      device: 'emulator.maxText',
      app: 'android.debug',
    },
  },
};
