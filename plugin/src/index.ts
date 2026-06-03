import {
  AndroidConfig,
  type ConfigPlugin,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
} from 'expo/config-plugins';

const PLUGIN_NAME = 'expo-ar';
// Bump when the native mods below change; used only for run-once de-duping. Kept in
// sync with package.json by convention (not imported to avoid a rootDir escape).
const PLUGIN_VERSION = '0.1.0';

const DEFAULT_CAMERA_PERMISSION = 'This app uses the camera for augmented reality.';

// ARCore availability metadata + AR camera feature. See:
// https://developers.google.com/ar/develop/java/enable-arcore
const AR_METADATA_NAME = 'com.google.ar.core';
const AR_FEATURE_NAME = 'android.hardware.camera.ar';

export type ExpoArPluginProps = {
  /** iOS `NSCameraUsageDescription` text shown in the camera permission prompt. */
  cameraPermission?: string;
  /**
   * When `true`, the app installs only on AR-capable devices: iOS adds `arkit` to
   * `UIRequiredDeviceCapabilities`; Android marks ARCore `required` and the AR camera
   * `uses-feature` required. When `false` (default), AR is `optional` so the non-AR
   * (`expo-camera`) fallback path stays reachable on non-AR devices.
   */
  arRequired?: boolean;
};

type ResolvedProps = Required<ExpoArPluginProps>;

const withExpoArIos: ConfigPlugin<ResolvedProps> = (config, { cameraPermission, arRequired }) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.NSCameraUsageDescription = cameraPermission;

    if (arRequired) {
      const capabilities = new Set<string>(
        (cfg.modResults.UIRequiredDeviceCapabilities as string[] | undefined) ?? []
      );
      capabilities.add('arkit');
      cfg.modResults.UIRequiredDeviceCapabilities = [...capabilities];
    }

    return cfg;
  });

const withExpoArAndroid: ConfigPlugin<ResolvedProps> = (config, { arRequired }) => {
  config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.CAMERA']);

  return withAndroidManifest(config, (cfg) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const { manifest } = cfg.modResults;

    // <meta-data android:name="com.google.ar.core" android:value="optional|required" />
    const metaValue = arRequired ? 'required' : 'optional';
    mainApplication['meta-data'] = mainApplication['meta-data'] ?? [];
    const existingMeta = mainApplication['meta-data'].find(
      (item) => item.$['android:name'] === AR_METADATA_NAME
    );
    if (existingMeta) {
      existingMeta.$['android:value'] = metaValue;
    } else {
      mainApplication['meta-data'].push({
        $: { 'android:name': AR_METADATA_NAME, 'android:value': metaValue },
      });
    }

    // <uses-feature android:name="android.hardware.camera.ar" android:required="true|false" />
    const requiredValue: 'true' | 'false' = arRequired ? 'true' : 'false';
    manifest['uses-feature'] = manifest['uses-feature'] ?? [];
    const existingFeature = manifest['uses-feature'].find(
      (item) => item.$['android:name'] === AR_FEATURE_NAME
    );
    if (existingFeature) {
      existingFeature.$['android:required'] = requiredValue;
    } else {
      manifest['uses-feature'].push({
        $: { 'android:name': AR_FEATURE_NAME, 'android:required': requiredValue },
      });
    }

    return cfg;
  });
};

const withExpoAr: ConfigPlugin<ExpoArPluginProps | undefined> = (config, props) => {
  const resolved: ResolvedProps = {
    cameraPermission: props?.cameraPermission ?? DEFAULT_CAMERA_PERMISSION,
    arRequired: props?.arRequired ?? false,
  };

  config = withExpoArIos(config, resolved);
  config = withExpoArAndroid(config, resolved);
  return config;
};

export default createRunOncePlugin(withExpoAr, PLUGIN_NAME, PLUGIN_VERSION);
