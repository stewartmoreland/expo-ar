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
const PLUGIN_VERSION = '0.2.0';

const DEFAULT_CAMERA_PERMISSION = 'This app uses the camera for augmented reality.';
const DEFAULT_LOCATION_PERMISSION =
  'This app uses your location to place augmented reality content at real-world places.';

// ARCore availability metadata + AR camera feature. See:
// https://developers.google.com/ar/develop/java/enable-arcore
const AR_METADATA_NAME = 'com.google.ar.core';
const AR_FEATURE_NAME = 'android.hardware.camera.ar';
// ARCore Geospatial (Earth API) API-key meta-data. See:
// https://developers.google.com/ar/develop/authorization?platform=android#api-key
const AR_API_KEY_METADATA_NAME = 'com.google.android.ar.API_KEY';

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
  /**
   * Enable the geospatial / VPS extension (place anchors at real lat/long). When `true`:
   * iOS adds `NSLocationWhenInUseUsageDescription`; Android adds `ACCESS_FINE_LOCATION` and,
   * if `arcoreApiKey` is set, the ARCore Geospatial API-key manifest meta-data. Defaults to
   * `false` so non-geo apps request no location permission.
   */
  geospatial?: boolean;
  /** iOS `NSLocationWhenInUseUsageDescription` text (only used when `geospatial` is true). */
  locationPermission?: string;
  /**
   * ARCore Geospatial API key (Android). Injected as the `com.google.android.ar.API_KEY`
   * meta-data so the Earth API can authenticate. Production apps should prefer keyless
   * (server-signed token) auth instead — see the README. Only used when `geospatial` is true.
   */
  arcoreApiKey?: string;
};

type ResolvedProps = Required<Omit<ExpoArPluginProps, 'arcoreApiKey'>> &
  Pick<ExpoArPluginProps, 'arcoreApiKey'>;

const withExpoArIos: ConfigPlugin<ResolvedProps> = (
  config,
  { cameraPermission, arRequired, geospatial, locationPermission }
) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.NSCameraUsageDescription = cameraPermission;

    // Geospatial extension: ARGeoTrackingConfiguration requires location authorization.
    if (geospatial) {
      cfg.modResults.NSLocationWhenInUseUsageDescription = locationPermission;
    }

    if (arRequired) {
      const capabilities = new Set<string>(
        (cfg.modResults.UIRequiredDeviceCapabilities as string[] | undefined) ?? []
      );
      capabilities.add('arkit');
      cfg.modResults.UIRequiredDeviceCapabilities = [...capabilities];
    }

    return cfg;
  });

const withExpoArAndroid: ConfigPlugin<ResolvedProps> = (
  config,
  { arRequired, geospatial, arcoreApiKey }
) => {
  const permissions = ['android.permission.CAMERA'];
  // Geospatial extension: ARCore Geospatial localization needs fine location.
  if (geospatial) {
    permissions.push('android.permission.ACCESS_FINE_LOCATION');
  }
  config = AndroidConfig.Permissions.withPermissions(config, permissions);

  return withAndroidManifest(config, (cfg) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const { manifest } = cfg.modResults;

    mainApplication['meta-data'] = mainApplication['meta-data'] ?? [];
    const upsertMeta = (name: string, value: string) => {
      const existing = mainApplication['meta-data']!.find((item) => item.$['android:name'] === name);
      if (existing) {
        existing.$['android:value'] = value;
      } else {
        mainApplication['meta-data']!.push({
          $: { 'android:name': name, 'android:value': value },
        });
      }
    };

    // <meta-data android:name="com.google.ar.core" android:value="optional|required" />
    upsertMeta(AR_METADATA_NAME, arRequired ? 'required' : 'optional');

    // Geospatial extension: API-key auth for the ARCore Geospatial (Earth) API.
    if (geospatial && arcoreApiKey) {
      upsertMeta(AR_API_KEY_METADATA_NAME, arcoreApiKey);
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
    geospatial: props?.geospatial ?? false,
    locationPermission: props?.locationPermission ?? DEFAULT_LOCATION_PERMISSION,
    arcoreApiKey: props?.arcoreApiKey,
  };

  config = withExpoArIos(config, resolved);
  config = withExpoArAndroid(config, resolved);
  return config;
};

export default createRunOncePlugin(withExpoAr, PLUGIN_NAME, PLUGIN_VERSION);
