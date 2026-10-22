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
  withDangerousMod,
  withMainApplication,
  withXcodeProject,
} = require('@expo/config-plugins');

const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

const withWidgetPlugin = (config, options = {}) => {
  const iosOptions = options.ios || {};
  const androidOptions = options.android || {};

  return withPlugins(config, [
    // iOS WidgetKit configuration
    [iosEntitlementsConfig, iosOptions],
    [iosInfoPlistConfig, iosOptions],
    [iosWidgetTargetConfig, iosOptions],
    withIosWidgetSources,

    // Android App Widget configuration
    [androidManifestConfig, androidOptions],
    [androidBuildConfig, androidOptions],
    [androidStringsConfig, androidOptions],
    withAndroidWidgetSources,
    withAndroidWidgetPackage,
  ]);
};

const withIosWidgetSources = (config) =>
  withDangerousMod(config, ['ios', iosWidgetSourcesConfig]);

const iosWidgetTargetConfig = async (config, options) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    const targetName = options.widgetTargetName || 'PetChainWidget';
    const nativeTargets = project.pbxNativeTargetSection();
    const existingTarget = Object.entries(nativeTargets).find(
      ([, target]) =>
        target && typeof target === 'object' && target.isa === 'PBXNativeTarget' &&
        target.name === `"${targetName}"`,
    );

    if (existingTarget) return config;

    const target = project.addTarget(
      targetName,
      'app_extension',
      targetName,
      `${config.ios.bundleIdentifier || 'app.petchain.mobile'}.widget`,
    );
    const targetUuid = target.uuid;
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid);
    project.addSourceFile(`${targetName}/${targetName}.swift`, { target: targetUuid });

    const targetBuildConfigurations = project.pbxXCBuildConfigurationSection();
    Object.values(targetBuildConfigurations).forEach((buildConfiguration) => {
      if (
        !buildConfiguration ||
        typeof buildConfiguration !== 'object' ||
        buildConfiguration.isa !== 'XCBuildConfiguration' ||
        !buildConfiguration.buildSettings ||
        buildConfiguration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER !==
          `"${config.ios.bundleIdentifier || 'app.petchain.mobile'}.widget"`
      ) {
        return;
      }
      Object.assign(buildConfiguration.buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        CODE_SIGN_ENTITLEMENTS: `"${targetName}/${targetName}.entitlements"`,
        INFOPLIST_FILE: `"${targetName}/${targetName}-Info.plist"`,
        IPHONEOS_DEPLOYMENT_TARGET: '15.0',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '"1,2"',
      });
    });

    return config;
  });

const iosWidgetSourcesConfig = async (config) => {
  const projectRoot = config.modRequest.projectRoot;
  const iosRoot = config.modRequest.platformProjectRoot;
  const widgetName = config.ios?.widgetTargetName || 'PetChainWidget';
  const targetRoot = path.join(iosRoot, widgetName);
  const appGroup = config.ios?.appGroup || 'group.app.petchain.mobile';
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, 'ios-widget/PetChainWidget.swift'),
    path.join(targetRoot, `${widgetName}.swift`),
  );
  fs.writeFileSync(
    path.join(targetRoot, `${widgetName}-Info.plist`),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleDisplayName</key><string>PetChain Care Agenda</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundlePackageType</key><string>XPC!</string><key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict></dict></plist>\n`,
  );
  fs.writeFileSync(
    path.join(targetRoot, `${widgetName}.entitlements`),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>com.apple.security.application-groups</key><array><string>${appGroup}</string></array></dict></plist>\n`,
  );
  return config;
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
  const widgetName = options.widgetName || 'PetChainWidget';

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
            { $: { 'android:name': 'app.petchain.mobile.UPDATE_WIDGET' } },
            { $: { 'android:name': 'android.intent.action.SCREEN_OFF' } },
            { $: { 'android:name': 'android.intent.action.USER_PRESENT' } },
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

    return config;
  });
};

const withAndroidWidgetSources = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidRoot = config.modRequest.platformProjectRoot;
      const javaTarget = path.join(androidRoot, 'app/src/main/java/app/petchain/mobile/widget');
      const xmlTarget = path.join(androidRoot, 'app/src/main/res/xml');
      fs.mkdirSync(javaTarget, { recursive: true });
      fs.mkdirSync(xmlTarget, { recursive: true });

      for (const source of [
        'PetChainWidgetModule.java',
        'PetChainWidgetProvider.java',
        'PetChainWidgetPackage.java',
      ]) {
        fs.copyFileSync(
          path.join(projectRoot, 'android-widget', source),
          path.join(javaTarget, source),
        );
      }
      fs.copyFileSync(
        path.join(projectRoot, 'android-widget/widget_provider.xml'),
        path.join(xmlTarget, 'widget_provider.xml'),
      );
      return config;
    },
  ]);

const withAndroidWidgetPackage = (config) =>
  withMainApplication(config, (config) => {
    const { language } = config.modResults;
    let { contents } = config.modResults;
    const importLine = 'import app.petchain.mobile.widget.PetChainWidgetPackage';

    if (!contents.includes(importLine)) {
      contents = contents.replace(/^(package [^\n]+\n)/, `$1\n${importLine}\n`);
    }

    if (language === 'kt') {
      const packageList = 'PackageList(this).packages.apply {';
      if (contents.includes(packageList) && !contents.includes('add(PetChainWidgetPackage())')) {
        contents = contents.replace(
          packageList,
          `${packageList}\n        add(PetChainWidgetPackage())`,
        );
      }
    } else {
      const packageList = 'List<ReactPackage> packages = new PackageList(this).getPackages();';
      if (contents.includes(packageList) && !contents.includes('packages.add(new PetChainWidgetPackage())')) {
        contents = contents.replace(
          packageList,
          `${packageList}\n        packages.add(new PetChainWidgetPackage());`,
        );
      }
    }

    config.modResults.contents = contents;
    return config;
  });

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
