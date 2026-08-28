/**
 * Expo Plugin for PetChain Widgets
 *
 * Integrates iOS WidgetKit and Android App Widget support
 * - iOS: Creates app groups for shared data
 * - Android: Registers widget provider and native module
 */

const {
  withEntitlementsPlist,
  withInfoPlist,
  withPlugins,
  withBuildGradle,
  withStringsXml,
  withAndroidManifest,
  withXcodeProject,
  ConfigPlugin,
} = require('@expo/config-plugins');

const pkg = require('./package.json');

const withWidgetPlugin = (config, options = {}) => {
  const iosOptions = options.ios || {};
  const androidOptions = options.android || {};

  return withPlugins(config, [
    // iOS WidgetKit configuration
    [withEntitlementsPlist, [iosEntitlementsConfig, iosOptions]],
    [withInfoPlist, [iosInfoPlistConfig, iosOptions]],

    // Android App Widget configuration
    [withAndroidManifest, [androidManifestConfig, androidOptions]],
    [withBuildGradle, [androidBuildConfig, androidOptions]],
    [withStringsXml, [androidStringsConfig, androidOptions]],
  ]);
};

// ─── iOS Configuration ─────────────────────────────────────────────────────

const iosEntitlementsConfig = async (config, options) => {
  const appGroup = options.appGroup || 'group.app.petchain.mobile';

  return withEntitlementsPlist(config, (config) => {
    if (!config.modResults['com.apple.security.application-groups']) {
      config.modResults['com.apple.security.application-groups'] = [];
    }

    const groups = config.modResults['com.apple.security.application-groups'];
    if (!groups.includes(appGroup)) {
      groups.push(appGroup);
    }

    return config;
  });
};

const iosInfoPlistConfig = async (config, options) => {
  return withInfoPlist(config, (config) => {
    // Add any iOS-specific info.plist entries if needed
    if (!config.modResults.NSWidgetSupported) {
      config.modResults.NSWidgetSupported = true;
    }

    return config;
  });
};

// ─── Android Configuration ─────────────────────────────────────────────────

const androidManifestConfig = async (config, options) => {
  const widgetName = options.widgetName || 'PetChainAppWidget';

  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // Ensure receivers array exists
    if (!manifest.manifest.receiver) {
      manifest.manifest.receiver = [];
    }

    // Add widget provider receiver
    const receiver = {
      $: {
        'android:name': `app.petchain.mobile.widget.${widgetName}Provider`,
        'android:label': 'PetChain Widget',
        'android:exported': 'true',
      },
      'intent-filter': [
        {
          action: [
            {
              $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' },
            },
          ],
        },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': '@xml/widget_provider',
          },
        },
      ],
    };

    manifest.manifest.receiver.push(receiver);

    // Add widget update receiver
    const updateReceiver = {
      $: {
        'android:name': `app.petchain.mobile.widget.${widgetName}Provider`,
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [
            {
              $: {
                'android:name': 'app.petchain.mobile.UPDATE_WIDGET',
              },
            },
          ],
        },
      ],
    };

    manifest.manifest.receiver.push(updateReceiver);

    return config;
  });
};

const androidBuildConfig = async (config, options) => {
  return withBuildGradle(config, (config) => {
    // Add any Gradle dependencies for widgets if needed
    const content = config.modResults.contents;

    if (!content.includes('com.google.android.gms:play-services-base')) {
      // Widget may need play services, add if needed
    }

    return config;
  });
};

const androidStringsConfig = async (config, options) => {
  return withStringsXml(config, (config) => {
    // Add widget description string
    const strings = config.modResults.resources.string || [];

    const widgetDescIndex = strings.findIndex((s) => s.$.name === 'widget_description');

    if (widgetDescIndex === -1) {
      strings.push({
        $: { name: 'widget_description' },
        _: 'View your pet health, medications, and appointments',
      });
    }

    return config;
  });
};

module.exports = withWidgetPlugin;
